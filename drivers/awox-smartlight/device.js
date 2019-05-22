'use strict';

// On first connect:
// mesh_name = "unpaired", mesh_password = "1234"
const STR_MESH_NAME = 'unpaired';
const STR_MESH_PASSWORD = '1234';

// Commands :

//: Set mesh groups.
//: Data : 3 bytes  
const C_MESH_GROUP = 0xd7;

//: Set the mesh id. The light will still answer to the 0 mesh id. Calling the 
//: command again replaces the previous mesh id.
//: Data : the new mesh id, 2 bytes in little endian order
const C_MESH_ADDRESS = 0xe0;

//:
const C_MESH_RESET = 0xe3;

//: On/Off command. Data : one byte 0, 1
const C_POWER = 0xd0;

//: Data : one byte
const C_LIGHT_MODE = 0x33;

//: Data : one byte 0 to 6 
const C_PRESET = 0xc8;

//: White temperature. one byte 0 to 0x7f
const C_WHITE_TEMPERATURE = 0xf0;

//: one byte 1 to 0x7f 
const C_WHITE_BRIGHTNESS = 0xf1;

//: 4 bytes : 0x4 red green blue
const C_COLOR = 0xe2;

//: one byte : 0xa to 0x64 .... 
const C_COLOR_BRIGHTNESS = 0xf2;

//: Data 4 bytes : How long a color is displayed in a sequence in milliseconds as 
//:   an integer in little endian order
const C_SEQUENCE_COLOR_DURATION = 0xf5;

//: Data 4 bytes : Duration of the fading between colors in a sequence, in 
//:   milliseconds, as an integer in little endian order
const C_SEQUENCE_FADE_DURATION = 0xf6;

//: 7 bytes
const C_TIME = 0xe4;

//: 10 bytes
const C_ALARMS = 0xe5;


const SERVICE_CHAR_UUID = '000102030405060708090a0b0c0d1910';
const STATUS_CHAR_UUID = '000102030405060708090a0b0c0d1911';  //properties=read,write,notify                     <Buffer 00>
const COMMAND_CHAR_UUID = '000102030405060708090a0b0c0d1912'; //properties=read,writeWithoutResponse,write       <Buffer 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00>
const OTA_CHAR_UUID = '000102030405060708090a0b0c0d1913';     //properties=read,writeWithoutResponse             <Buffer e0 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00>
const PAIR_CHAR_UUID = '000102030405060708090a0b0c0d1914';    //properties=read,write                            <Buffer 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00>

var LightModeEnum = {"color":1, "temperature":2};

const Homey = require('homey');
const packetutils = require('../../lib/packetutils.js');
const CryptoJS = require('crypto-js');
const ColorConvert = require('color-convert');

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

class AwoxSmartlightDevice extends Homey.Device {

    onInit() {
        this.log('AwoxSmartlightDevice has been inited');

        this.log(this.getData());

        this.registerCapabilityListener('onoff', ( value, opts ) => {
            this.log(`on/off requested: ${value}`);
            if (value)
            {
                this.turnOn()
                    .catch( err => {
                        console.error(err);
                        return Promise.reject(error);
                    });
            }
            else
            {
                this.turnOff()
                    .catch( err => {
                        console.error(err);
                        return Promise.reject(error);
                    });
            }
            return Promise.resolve(true);
        });

        this.registerCapabilityListener('dim', async (value) => {
            try {
                this.log(`dim requested: ${value}`);
                if (this.light_mode == LightModeEnum.color)
                {
                    this.setColorBrightness(value)
                        .catch( err => {
                            console.error(err);
                            return Promise.reject(error);
                        });
                }
                else
                {
                    this.setWhiteBrightness(value)
                        .catch( err => {
                            console.error(err);
                            return Promise.reject(error);
                        });
                }

                return Promise.resolve(true);
            } catch (error) {
                return Promise.reject(error);
            }
        });

        this.registerMultipleCapabilityListener(['light_hue', 'light_saturation'], async (valueObj) => {
            try {
                this.log(`hue requested: ${valueObj.light_hue}`);
                this.log(`saturation requested: ${valueObj.light_saturation}`);

                // Map value from Hue[0.0 - 1.0] to Hue[0 - 360] (degrees)
                // Map value from Saturation[0.0 - 1.0] to Saturation[0 - 100] (percent)
                // Use 100% Value
                var rgb = ColorConvert.hsv.rgb(valueObj.light_hue*360, valueObj.light_saturation*100, 100);

                this.log("Setting color:", rgb);
                await this.setColor(rgb[0], rgb[1], rgb[2])
                    .catch( err => {
                        console.error(err);
                        return Promise.reject(error);
                    });

                return Promise.resolve(true);
            } catch (error) {
                return Promise.reject(error);
            }
        }, 500);

        this.registerCapabilityListener('light_mode', async (value) => {
            try {
                this.log(`light_mode requested: ${value}`);
                if (value == "color")
                {
                    this.light_mode = LightModeEnum.color;

                    // When switching to color, get the Dim value and set it to the ColorBrightness
                    var dimVal = await this.getCapabilityValue("dim");
                    this.setColorBrightness(dimVal)
                        .catch( err => {
                            console.error(err);
                            return Promise.reject(error);
                        });
                }
                else if (value == "temperature")
                {
                    this.light_mode = LightModeEnum.temperature;

                    // When switching to temperature, get the Dim value and set it to the WhiteBrightness
                    var dimVal = await this.getCapabilityValue("dim");
                    this.setWhiteBrightness(dimVal)
                        .catch( err => {
                            console.error(err);
                            return Promise.reject(error);
                        });
                }
                else
                {
                    return Promise.reject("light_mode: Unknown value received (expected color/temperature): " + value);
                }

                return Promise.resolve(true);
            } catch (error) {
                return Promise.reject(error);
            }
        });

        this.registerCapabilityListener('light_temperature', async (value) => {
            try {
                this.log(`light_temperature requested: ${value}`);
                this.setWhiteTemperature(value)
                    .catch( err => {
                        console.error(err);
                        return Promise.reject(error);
                    });
                return Promise.resolve(true);
            } catch (error) {
                return Promise.reject(error);
            }
        });

    }

    onAdded()
    {
        var connected = this.connectService()
            .then(async () => {
                this.log("Device paired. Setting mesh user/pass...");
                await this.setMesh("unpaired", "1234", "Homey");
                this.log("Mesh set.");
                return Promise.resolve(true);
            })
            .catch((error) => {
                return Promise.reject(error);
            });
    }

    onDeleted()
    {
        this.log("Deleting device...");
        this.resetMesh();
        this.log("Mesh resetted");
    }

    async ensureConnected()
    {
        if (typeof this.blePeripheral !== 'undefined')
        {
            if (!this.blePeripheral.isConnected)
            {
                await this.connectService();
            }
        }
        else
        {
            await this.connectService();
        }
    }

    // Turns the light on.
    async turnOn()
    {
        try {
            // write command 'on' to the peripheral
            var onBuf = Buffer.alloc(1);
            onBuf.writeUInt8(0x01, 0);
            await this.writeCommand (C_POWER, onBuf, 0);

            this.log("[turnOn] Command written");
            return Promise.resolve(true);

        } catch (error) {
            await this.disconnect();
            return Promise.reject(error);
        }
    }

    // Turns the light off.
    async turnOff()
    {
        try {
            // write command 'off' to the peripheral
            var offBuf = Buffer.alloc(1);
            offBuf.writeUInt8(0x00, 0);
            await this.writeCommand (C_POWER, offBuf, 0);

            this.log("[turnOff] Command written");
            return Promise.resolve(true);

        } catch (error) {
            await this.disconnect();
            return Promise.reject(error);
        }
    }

    // Args:
    //     command: The command, as a number.
    //     data: The parameters for the command, as bytes.
    //     dest: The destination mesh id, as a number. If None, this lightbulb's
    //         mesh id will be used.
    async writeCommand (command, data, dest)
    {
        await this.ensureConnected();

        var cmdPacket = packetutils.make_command_packet (this.session_key, this.mac, dest, command, data);
        this.log ("Writing command=", command, " ; data=", data);

        // Write command to the COMMAND char content
        await this.bleService.write(COMMAND_CHAR_UUID, cmdPacket);
    }

    // Args :
    //     red, green, blue: between 0 and 0xff
    async setColor(red, green, blue)
    {
        var colorBuf = Buffer.alloc(4);
        colorBuf.writeUInt8(0x04, 0);
        colorBuf.writeUInt8(red, 1); //red
        colorBuf.writeUInt8(green, 2); //green
        colorBuf.writeUInt8(blue, 3); //blue

        await this.writeCommand(C_COLOR, colorBuf, 0);
    }

    // Args :
    //     brightness: a value between 0xa and 0x64 ...
    async setColorBrightness(brightness)
    {
        // Map value from [0.0 - 1.0] to [0xa - 0x64] / [10 - 100]
        var val = 10.0 + (brightness * 90.0);

        var brightnessBuf = Buffer.alloc(1);
        brightnessBuf.writeUInt8(val, 0);

        await this.writeCommand(C_COLOR_BRIGHTNESS, brightnessBuf, 0);
    }

    // Set a preset color sequence.
    // Args :
    //     num: number between 0 and 6
    async setPreset(presetNum)
    {
        var presetBuf = Buffer.alloc(1);
        presetBuf.writeUInt8(presetNum, 0);

        await this.writeCommand(C_PRESET, presetBuf, 0);
    }

    // Args:
    //     duration: in milliseconds.
    async setSequenceFadeDuration(duration)
    {
        var durationBuf = Buffer.alloc(4);
        durationBuf.writeInt32LE( duration, 0 );

        await this.writeCommand(C_SEQUENCE_FADE_DURATION, durationBuf, 0);
    }

    // Args :
    //     duration: in milliseconds.
    async setSequenceColorDuration(duration)
    {
        var durationBuf = Buffer.alloc(4);
        durationBuf.writeInt32LE( duration, 0 );

        await this.writeCommand(C_SEQUENCE_COLOR_DURATION, durationBuf, 0);
    }

    // Args :
    //     temp: between 0 and 0x7f
    async setWhiteTemperature (temp)
    {
        // Map value from [0.0 - 1.0] to [0x0 - 0x7f] / [0 - 127]
        var val = (temp * 127.0);

        var whiteTempBuf = Buffer.alloc(1);
        whiteTempBuf.writeUInt8(val, 0);
        await this.writeCommand(C_WHITE_TEMPERATURE, whiteTempBuf, 0);
    }

    // Args :
    //     brightness: between 1 and 0x7f
    async setWhiteBrightness (brightness)
    {
        // Map value from [0.0 - 1.0] to [0x01 - 0x7f] / [1 - 127]
        var val = 1.0 + (brightness * 126.0);

        var whiteBrightnessBuf = Buffer.alloc(1);
        whiteBrightnessBuf.writeUInt8(val, 0);
        await this.writeCommand(C_WHITE_BRIGHTNESS, whiteBrightnessBuf, 0);
    }

    async connectService() {

        // Generate a Buffer of size 8 with random byte values
        var session_random = Buffer.from( CryptoJS.lib.WordArray.random(128/16).toString(CryptoJS.enc.Hex), "hex");

        // Generate packet to PAIR
        var mesh_name = STR_MESH_NAME;
        var mesh_password = STR_MESH_PASSWORD;
        var pairPacket = packetutils.make_pair_packet(mesh_name, mesh_password, session_random);

        // Status packet to PAIR with lamp
        var statusPacket = Buffer.from("01", "hex");

        try {

            // Find the BLE device
            const bleAdvertisement = await Homey.ManagerBLE.find( this.getData()["uuid"] );

            this.log("connecting to blePeripheral");

            // Connect to the BLE device
            this.blePeripheral = await bleAdvertisement.connect();
            this.mac = this.blePeripheral.address;
            this.mesh_id = 0;

            this.log("connected to blePeripheral");

            await sleep(100);

            this.bleService = await this.blePeripheral.getService(SERVICE_CHAR_UUID); 

            this.log("got service from blePeripheral");

            this.bleCharacteristics = await this.bleService.discoverCharacteristics();

            this.log("discovered characteristics from bleService");

            // Get the PAIR characteristic content
            var pairCharData = await this.bleService.read(PAIR_CHAR_UUID);
            this.log("pairCharData", pairCharData);

            // Write the auth packet
            await this.bleService.write(PAIR_CHAR_UUID, pairPacket);

            // Write status packet to the STATUS char content
            await this.bleService.write(STATUS_CHAR_UUID, statusPacket);

            // Get the PAIR characteristic content
            var pairCharData = await this.bleService.read(PAIR_CHAR_UUID);
            this.log("pairCharData", pairCharData);

            if (pairCharData[0] == 0x0D)
            {
                this.session_key = packetutils.make_session_key( mesh_name, mesh_password, session_random, pairCharData.slice(1, 9) );
                this.log("Connected.");

                //await this.setColor(0x00, 0x00, 0xFF);
                //await this.setColorBrightness(0x30);

                //await this.setPreset(0);
                //await this.setSequenceFadeDuration(10);
                //await this.setSequenceColorDuration(10);
                return Promise.resolve(true);
            }
            else if (pairCharData[0] == 0x0E)
            {
                this.log("Auth error : check name and password.");
                this.disconnect();
                return Promise.resolve(false);
            }
            else
            {
                this.log("Unexpected value in PAIR response -- expected 0x0D or 0x0E on index 0:", pairCharData);
                this.disconnect();
                return Promise.resolve(false);
            }

        } catch (error) {
            this.log("Unable to connect:", error.message);
            this.disconnect();
            return Promise.reject(error);
        }
    }

    async disconnect() 
    {
        if (this.blePeripheral && this.blePeripheral.isConnected) {
            this.log('disconnecting from peripheral');
            await this.blePeripheral.disconnect()
                .catch(() => null);
        }
        return Promise.resolve(true);
    }


    // Sets or changes the mesh network settings.
    // Args :
    //     new_mesh_name: The new mesh name as a string, 16 bytes max.
    //     new_mesh_password: The new mesh password as a string, 16 bytes max.
    //     new_mesh_long_term_key: The new long term key as a string, 16 bytes max.
    // Returns :
    //     True on success.
    async setMesh (new_mesh_name, new_mesh_password, new_mesh_long_term_key)
    {
        // Write the mesh_name packet
        var mesh_name_bytecode = Buffer.from("04", "hex");
        var mesh_name_packet = packetutils.encrypt( this.session_key, new_mesh_name );
        var msg = Buffer.concat( [mesh_name_bytecode, mesh_name_packet] );
        this.log("mesh_name:", msg);
        await this.bleService.write(PAIR_CHAR_UUID, msg);

        // Write the mesh_password packet
        var mesh_password_bytecode = Buffer.from("05", "hex");
        var mesh_password_packet = packetutils.encrypt( this.session_key, new_mesh_password );
        msg = Buffer.concat( [mesh_password_bytecode, mesh_password_packet] );
        await this.bleService.write(PAIR_CHAR_UUID, msg);

        // Write the mesh_long_term_key packet
        var mesh_long_term_key_bytecode = Buffer.from("06", "hex");
        var mesh_long_term_key_packet = packetutils.encrypt( this.session_key, new_mesh_long_term_key );
        msg = Buffer.concat( [mesh_long_term_key_bytecode, mesh_long_term_key_packet] );
        await this.bleService.write(PAIR_CHAR_UUID, msg);

        // Status packet to PAIR with lamp
        var statusPacket = Buffer.from("01", "hex");
        // Write status packet to the STATUS char content
        await this.bleService.write(STATUS_CHAR_UUID, statusPacket);

        await sleep(1000);

        // Get the PAIR characteristic content
        var pairCharData = await this.bleService.read(PAIR_CHAR_UUID);
        this.log("pairCharData", pairCharData);

        if (pairCharData[0] == 0x07)
        {
            this.mesh_name = new_mesh_name;
            this.mesh_password = new_mesh_password;
            this.log("Mesh network settings accepted.");
            return Promise.resolve(true);
        }
        else
        {
            this.log(pairCharData);
            this.log("Mesh network settings change failed:", pairCharData);
            var message = packetutils.decrypt_packet (this.session_key, this.mac, pairCharData);
            this.log("Received message : ", message)
            return Promise.resolve(false);
        }
    }

    // Sets the mesh id.
    // Args :
    //     mesh_id: as a number.
    async setMeshId (mesh_id)
    {
        var msg = Buffer.alloc(2);
        msg.writeInt16LE(mesh_id);
        this.writeCommand(C_MESH_ADDRESS, msg, 0);
        this.mesh_id = mesh_id;
        return Promise.resolve(true);
    }

    // Restores the default name and password. Will disconnect the device.
    async resetMesh()
    {
        var msg = Buffer.alloc(1);
        this.writeCommand(C_MESH_RESET, msg, 0);
        return Promise.resolve(true);
    }

}

module.exports = AwoxSmartlightDevice;
