import { OAuth2App } from 'homey-oauth2app';
import BambuOAuth2Client from './BambuOAuth2Client.mjs';
import BambuAms from './BambuAms.mjs';

export default class BambuApp extends OAuth2App {

  static OAUTH2_CLIENT = BambuOAuth2Client;
  static OAUTH2_DEBUG = true;

  async onOAuth2Init() {
    try {
      // Widget — Status
      this.homey.dashboards
        .getWidget('status')
        .registerSettingAutocompleteListener('device', async (query, settings) => {
          const driver = await this.homey.drivers.getDriver('cloud');
          const devices = await driver.getDevices();

          return Object.values(devices)
            .map(device => ({
              deviceId: device.getData().deviceId,
              name: device.getName(),
            }))
            .filter(item => item.name.toLowerCase().includes(query.toLowerCase()));
        });

      // Widget — AMS
      this.homey.dashboards
        .getWidget('ams')
        .registerSettingAutocompleteListener('device', async (query, settings) => {
          const driver = await this.homey.drivers.getDriver('cloud');
          const devices = await driver.getDevices();

          return Object.values(devices)
            .map(device => ({
              deviceId: device.getData().deviceId,
              name: device.getName(),
            }))
            .filter(item => item.name.toLowerCase().includes(query.toLowerCase()));
        });


      this.homey.dashboards
        .getWidget('ams')
        .registerSettingAutocompleteListener('ams', async (query, settings) => {
          const driver = await this.homey.drivers.getDriver('cloud');
          const devices = await driver.getDevices();
          const device = devices.find(device => device.getData().deviceId === settings?.device?.deviceId);
          if (!device) {
            throw new Error('Device Not Found');
          }

          const units = device.state?.print?.ams?.ams ?? [];
          return units.map(ams => ({
            amsId: ams.id,
            name: BambuAms.getUnitName({ units, unit: ams }),
          }));
        });

    } catch (err) {
      this.log(`Dashboards might not be available: ${err.message}`);
    }
  }

  async getDevice({ deviceId }) {
    const driver = this.homey.drivers.getDriver('cloud');
    const device = driver.getDevices().find(device => device.getData().deviceId === deviceId);
    if (!device) {
      throw new Error('Device Not Found');
    }

    return device;
  }

}
