'use strict';

const BLE_SERVICES_GENERIC_ACCESS = '1800';
const BLE_CHARACTERISTICS_DEVICE_NAME = '2a00';
const BLE_CHARACTERISTICS_APPEARANCE = '2a01';

const BLE_SERVICES_DEVICE_INFORMATION = '180a';
const BLE_CHARACTERISTICS_MODEL_NUMBER_STRING = '2a24';
const BLE_CHARACTERISTICS_FIRMWARE_REVISION_STRING = '2a26';
const BLE_CHARACTERISTICS_HARDWARE_REVISION_STRING = '2a27';
const BLE_CHARACTERISTICS_MANUFACTURER_Name_STRING = '2a29';

const Homey = require('homey');

class AwoxSmartlightDriver extends Homey.Driver {

    onInit() {
        this.log('AwoxSmartlightDriver has been inited');
    }

    onPairListDevices(data, callback) {
        this.log('pair listing of devices started');
        this.discoverLights()
            .then((deviceList) => {
                callback(null, deviceList);
            })
        .catch((error) => {
            callback(error);
        });
    }

    async discoverLights() {
        this.log('device discovery started');
        try {
            // discover all peripherals that have AwoX Company Identifier (0x0160)
            const bleAdvertisements = await Homey.ManagerBLE.discover();

            var awoxLights = [];
            for (var i = 0; i < bleAdvertisements.length; i++)
            {
                var manufacturerID = bleAdvertisements[i].manufacturerData.readInt16LE();
                this.log("Found a device with manufacturer ID:", manufacturerID);
                if (manufacturerID == 0x0160)
                {
                    this.log("Connecting to an AwoX device...");
                    // Connect to the BLE device
                    var blePeripheral = await bleAdvertisements[i].connect();

                    // Discover everything after connecting to the BLE device
                    await blePeripheral.discoverAllServicesAndCharacteristics();

                    // Get device info
                    var device_name = await blePeripheral.read(BLE_SERVICES_GENERIC_ACCESS, BLE_CHARACTERISTICS_DEVICE_NAME);
                    var appearance = await blePeripheral.read(BLE_SERVICES_GENERIC_ACCESS, BLE_CHARACTERISTICS_APPEARANCE);
                    var model_number = await blePeripheral.read(BLE_SERVICES_DEVICE_INFORMATION, BLE_CHARACTERISTICS_MODEL_NUMBER_STRING);
                    var firmware_version = await blePeripheral.read(BLE_SERVICES_DEVICE_INFORMATION, BLE_CHARACTERISTICS_FIRMWARE_REVISION_STRING);
                    var hardware_revision = await blePeripheral.read(BLE_SERVICES_DEVICE_INFORMATION, BLE_CHARACTERISTICS_HARDWARE_REVISION_STRING);
                    var manufacturer_name = await blePeripheral.read(BLE_SERVICES_DEVICE_INFORMATION, BLE_CHARACTERISTICS_MANUFACTURER_Name_STRING);

                    // Convert Buffer to human-readable string
                    device_name = device_name.toString('utf-8').replace(/\0/g, '');
                    appearance = appearance.toString('utf-8').replace(/\0/g, '');
                    firmware_version = firmware_version.toString('utf-8').replace(/\0/g, '');
                    manufacturer_name = manufacturer_name.toString('utf-8').replace(/\0/g, '');
                    model_number = model_number.toString('utf-8').replace(/\0/g, '');
                    hardware_revision = hardware_revision.toString('utf-8').replace(/\0/g, '');

                    const device = {
                        name: manufacturer_name + " " + device_name + " (" + bleAdvertisements[i].uuid + ")",
                        data:
                        {
                            uuid: bleAdvertisements[i].uuid,
                            firmware_version: firmware_version,
                            manufacturer_name: manufacturer_name,
                            model_number: model_number,
                            hardware_revision: hardware_revision,
                        },
                    };
                    awoxLights.push( device );

                    await blePeripheral.disconnect();
                }
            }
            return Promise.resolve(awoxLights);
        } catch (error) {
            await blePeripheral.disconnect();
            return Promise.reject(error);
        }
    }

}

module.exports = AwoxSmartlightDriver;
