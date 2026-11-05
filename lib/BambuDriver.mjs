import fs from 'node:fs/promises';
import path from 'node:path';

import {
  OAuth2Driver,
  OAuth2Util,
} from 'homey-oauth2app';
import { crossedBelow } from './BambuAms.mjs';

export default class BambuDriver extends OAuth2Driver {

  async onOAuth2Init() {
    this.homey.flow.getDeviceTriggerCard('filament_low').registerRunListener(async (args, state) => {
      return crossedBelow(state.previous, state.grams, args.grams);
    });

    this.homey.flow.getActionCard('pause').registerRunListener(async (args, state) => {
      await args.device.setPrintPaused();
    });

    this.homey.flow.getActionCard('resume').registerRunListener(async (args, state) => {
      await args.device.setPrintResume();
    });

    this.homey.flow.getActionCard('stop').registerRunListener(async (args, state) => {
      await args.device.setPrintStop();
    });

    this.homey.flow.getActionCard('set_print_speed').registerRunListener(async (args, state) => {
      await args.device.setPrintSpeed({
        speed: args.speed,
      });
    });

    this.homey.flow.getActionCard('set_chamber_light_on').registerRunListener(async (args, state) => {
      await args.device.setLightChamber({
        on: true,
      });
    });

    this.homey.flow.getActionCard('set_chamber_light_off').registerRunListener(async (args, state) => {
      await args.device.setLightChamber({
        on: false,
      });
    });
  }

  async onPair(session) {
    let email;

    const OAuth2ConfigId = this.getOAuth2ConfigId();
    let OAuth2SessionId = '$new';
    let client = this.homey.app.createOAuth2Client({
      sessionId: OAuth2Util.getRandomId(),
      configId: OAuth2ConfigId,
    });

    const savedSessions = this.homey.app.getSavedOAuth2Sessions();
    if (Object.keys(savedSessions).length) {
      OAuth2SessionId = Object.keys(savedSessions)[0];
      try {
        client = this.homey.app.getOAuth2Client({
          configId: OAuth2ConfigId,
          sessionId: OAuth2SessionId,
        });

        Homey.showView('list_devices');
      } catch (err) {
        this.error(err);
      }
    }

    session.setHandler('email', async email_ => {
      email = email_;
      await client.requestCode({ email });
    });

    session.setHandler('pincode', async code => {
      await client.loginWithEmailAndCode({
        email,
        code: code.join(''),
      });

      const clientSession = await client.onGetOAuth2SessionInformation();

      OAuth2SessionId = clientSession.id;
      const token = client.getToken();
      client.destroy();
      client = this.homey.app.createOAuth2Client({
        sessionId: OAuth2SessionId,
        configId: OAuth2ConfigId,
      });
      client.setToken({ token });

      return true;
    });

    session.setHandler('list_devices', async () => {
      const profile = await client.getProfile();
      const devices = await client.getDevices();

      const result = [];

      for (const device of Object.values(devices)) {
        const deviceObj = {
          name: device.name,
          data: {
            userId: String(profile.uid),
            deviceId: String(device.dev_id),
          },
          settings: {
            accessCode: String(device.dev_access_code),
            deviceId: String(device.dev_id),
            modelName: String(device.dev_model_name),
            productName: String(device.dev_product_name),
          },
          store: {
            OAuth2SessionId,
            OAuth2ConfigId,
          },
        };

        try {
          const iconPath = `/icons/${device.dev_model_name}.svg`;
          const iconExists = await fs.access(path.join(this.homey.dir, 'drivers', 'cloud', 'assets', iconPath)).then(() => true).catch(() => false);
          if (iconExists) {
            deviceObj.icon = iconPath;
          }
        } catch (err) {
          this.error(`Error loading icon for ${device.dev_model_name}: ${err}`);
        }

        result.push(deviceObj);
      }

      return result;
    });
  }

  async onRepair(session, device) {
    let email;
    const client = device.oAuth2Client;

    session.setHandler('email', async email_ => {
      email = email_;
      await client.requestCode({ email });
    });

    session.setHandler('pincode', async code => {
      await client.loginWithEmailAndCode({
        email,
        code: code.join(''),
      });
      await client.save();

      await device.uninit();
      await device.init();

      return true;
    });

  }

}