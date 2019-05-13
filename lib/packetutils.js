
'use strict';
const CryptoJS = require('crypto-js');

function reverseBuffer(src)
{
    var buffer = Buffer.allocUnsafe(src.length);

    for (var i = 0, j = src.length - 1; i <= j; ++i, --j) {
        buffer[i] = src[j];
        buffer[j] = src[i];
    }

    return buffer
};

function encrypt(key, value)
{
    var k = key;
    var val = value;

    k = reverseBuffer(k);
    val = reverseBuffer(val);

    var k_WordArray = CryptoJS.enc.Hex.parse(k.toString('hex'));
    var val_WordArray = CryptoJS.enc.Hex.parse(val.toString('hex'));

    var encrypted = CryptoJS.AES.encrypt(val_WordArray, k_WordArray, { mode: CryptoJS.mode.ECB, padding: CryptoJS.pad.NoPadding }); 
    //console.log("encrypted.ciphertext", encrypted.ciphertext.toString(CryptoJS.enc.Hex) );

    //var decrypted = CryptoJS.AES.decrypt(encrypted, k_WordArray, { mode: CryptoJS.mode.ECB, padding: CryptoJS.pad.NoPadding });
    //console.log("decrypted", decrypted.toString(CryptoJS.enc.Hex) );

    val = Buffer.from(encrypted.ciphertext.toString(CryptoJS.enc.Hex), "hex");
    val = reverseBuffer(val);

    return val;

};

function make_session_key(mesh_name, mesh_password, session_random, response_random)
{
    // Concatenate session_random + response_random in a new buffer
    var rand = Buffer.alloc(session_random.length + response_random.length);
    for (var i = 0; i < session_random.length; i++)
    {
        rand.writeUInt8( session_random[i], i );
    }
    for (var i = 0; i < response_random.length; i++)
    {
        rand.writeUInt8( response_random[i], response_random.length + i );
    }

    // mesh_name -- Allocate buffer(16) initialized with 0x0, write mesh_name
    var m_n = Buffer.alloc(16);
    m_n.write(mesh_name);

    // mesh_password -- Allocate buffer(16) initialized with 0x0, write mesh_password
    var m_p = Buffer.alloc(16);
    m_p.write(mesh_password);

    // name_pass -- Allocate buffer(16) initialized with 0x0, take the XOR of every byte from mesh_name and mesh_password combined
    var name_pass = Buffer.alloc(16);
    for (var i = 0; i < m_n.length; i++)
    {
        name_pass.writeUInt8( m_n[i] ^ m_p[i], i );
    }

    var key = encrypt (name_pass, rand);

    return key;
};

function make_pair_packet(mesh_name, mesh_password, session_random)
{
    // s_r -- Allocate buffer(16) initialized with 0x0, write session_random
    var s_r = Buffer.alloc(16);
    for (var i = 0; i < session_random.length; i++)
    {
        s_r.writeUInt8( session_random[i], i );
    }

    // mesh_name -- Allocate buffer(16) initialized with 0x0, write mesh_name
    var m_n = Buffer.alloc(16);
    m_n.write(mesh_name);

    // mesh_password -- Allocate buffer(16) initialized with 0x0, write mesh_password
    var m_p = Buffer.alloc(16);
    m_p.write(mesh_password);

    // name_pass -- Allocate buffer(16) initialized with 0x0, take the XOR of every byte from mesh_name and mesh_password combined
    var name_pass = Buffer.alloc(16);
    for (var i = 0; i < m_n.length; i++)
    {
        name_pass.writeUInt8( m_n[i] ^ m_p[i], i );
    }

    // encrypt session_random with name_pass using AES mode.ECB
    var enc = encrypt(s_r, name_pass);

    // packet -- Allocate packet buffer:
    // [0] = 0x0C
    // [1] - [8] = session_random
    // [9] - [16] = first 8 bytes from AES encryption
    var packet = Buffer.alloc(1 + session_random.length + 8);
    packet.writeUInt8( 0x0C, 0 );
    for (var i = 0; i < session_random.length; i++)
    {   
        packet.writeUInt8( session_random[i], i+1 );
    }
    for (var i = 0; i < 8; i++)
    {
        packet.writeUInt8( enc[i], 1 + session_random.length + i );
    }

    return packet;
};

function make_checksum(key, nonce, payload)
{
    // nonce + len(payload)
    var base = Buffer.alloc(16);
    for (var i = 0; i < nonce.length; i++)
    {   
        base.writeUInt8( nonce[i], i );
    }
    base.writeUInt8( payload.length, nonce.length );

    var check = encrypt(key, base);

    // for i in range (0, len (payload), 16):
    for (var i = 0; i < payload.length; i += 16)
    {
        // check_payload = bytearray (payload[i:i+16].ljust (16, b'\x00'))
        var check_payload = Buffer.alloc(16);
        for (var j = 0; j < payload.slice(i, i+16).length; j++)
        {
            check_payload.writeUInt8( payload.slice(i, i+16)[j], j );
        }

        // check = bytearray([ a ^ b for (a,b) in zip(check, check_payload) ])
        var temp_check = Buffer.alloc(16);
        for (var j = 0; j < check_payload.length; j++)
        {
            temp_check.writeUInt8( check[j] ^ check_payload[j], j );
        }
        check = temp_check;

        // check = encrypt (key, check)
        temp_check = encrypt(key, check);
        check = temp_check;
    }

    return check;
};

function crypt_payload(key, nonce, payload)
{
    // base = 0x0 + nonce
    var base = Buffer.alloc(16);
    base.writeUInt8( 0x0, 0 );
    for (var i = 0; i < nonce.length; i++)
    {   
        base.writeUInt8( nonce[i], 1+i );
    }

    var result = Buffer.alloc(0);

    // for i in range (0, len (payload), 16):
    for (var i = 0; i < payload.length; i += 16)
    {
        // enc_base = encrypt (key, base)
        var enc_base = encrypt(key, base);

        // result += bytearray ([ a ^ b for (a,b) in zip (enc_base, bytearray (payload[i:i+16]))])
        var length_to_add = Math.min( enc_base.length, payload.slice(i,i+16).length );
        var tmp_result = Buffer.alloc( result.length + length_to_add );
        // first copy the old result to the new tmp_result
        for (var j = 0; j < result.length; j++)
        {
            tmp_result.writeUInt8( result[j], j );
        }
        // then copy the new slice, starting from result.length
        for (var j = 0; j < length_to_add; j++)
        {
            tmp_result.writeUInt8( enc_base[j] ^ payload.slice(i, i+16)[j], result.length + j );
        }
        result = tmp_result;

        // base[0] += 1
        base[0] = base[0] + 1;
    }

    return result;
};

function make_command_packet(key, address, dest_id, command, data)
{
    // Sequence number of 3 random byte values, just need to be different
    var s = Buffer.from( CryptoJS.lib.WordArray.random(3).toString(CryptoJS.enc.Hex), "hex");

    // Build nonce
    // [0] - [3] = reversedAddress[0] - reversedAddress[3]
    // [4] = 0x01
    // [5] - [7] = s[0] - s[2]
    var a = Buffer.from(address.replace(/:/g,""), "hex");
    a = reverseBuffer(a);
    var nonce = Buffer.alloc(4 + 1 + s.length);
    for (var i = 0; i < 4; i++)
    {
        nonce.writeUInt8( a[i], i );
    }
    nonce.writeUInt8( 0x01, 4 );
    for (var i = 0; i < s.length; i++)
    {
        nonce.writeUInt8( s[i], 5 + i );
    }

    // Build payload
    // [0] = dest_id
    // [1] = 0x0
    // [2] = command
    // [3] = 0x60
    // [4] = 0x01
    // [5] - [8] = data
    var payload = Buffer.alloc(15);
    payload.writeUInt8( dest_id, 0 );
    payload.writeUInt8( command, 2 );
    payload.writeUInt8(    0x60, 3 );
    payload.writeUInt8(    0x01, 4 );
    for (var i = 0; i < data.length; i++)
    {
        payload.writeUInt8( data[i], 5 + i );
    }

    // Compute checksum
    var check = make_checksum (key, nonce, payload);

    // Encrypt payload
    payload = crypt_payload (key, nonce, payload);

    // Make packet
    // packet = s + check[0:2] + payload
    var packet = Buffer.alloc(s.length + 2 + payload.length);
    for (var i = 0; i < s.length; i++)
    {
        packet.writeUInt8( s[i], i );
    }
    packet.writeUInt8( check[0], s.length + 0 );
    packet.writeUInt8( check[1], s.length + 1 );
    for (var i = 0; i < payload.length; i++)
    {
        packet.writeUInt8( payload[i], s.length + 2 + i );
    }

    return packet;
};

module.exports.reverseBuffer = reverseBuffer;
module.exports.encrypt = encrypt;
module.exports.make_session_key = make_session_key;
module.exports.make_pair_packet = make_pair_packet;
module.exports.make_checksum = make_checksum;
module.exports.crypt_payload = crypt_payload;
module.exports.make_command_packet = make_command_packet;
