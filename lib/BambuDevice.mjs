import { OAuth2Device, fetch } from 'homey-oauth2app';
import mqtt from 'mqtt';

import BambuUtil from './BambuUtil.mjs';

export default class BambuDriver extends OAuth2Device {

  state = {};

  jobId = null;
  jobName = null;
  jobTask = null;
  jobImage = null;

  printState = null;
  isConnected = false;

  async onOAuth2Init() {
    this.registerCapabilityListener('onoff.light_chamber', async value => {
      await this.setLightChamber({
        on: !!value,
      });
    });

    this.registerCapabilityListener('onoff.light_work', async value => {
      await this.setLightWork({
        on: !!value,
      });
    });

    this.registerCapabilityListener('bambu_print_speed', async value => {
      await this.setPrintSpeed({
        speed: value,
      });
    });

    await this.init();
  }

  async onOAuth2Uninit() {
    await this.uninit();
  }

  async onOAuth2Added() {
    await this.oAuth2Client.save();
  }

  async onSettings({ changedKeys }) {
    if (changedKeys.includes('hostname') || changedKeys.includes('accessCode')) {
      Promise.resolve().then(async () => {
        this.disconnect();
        this.tryConnect();
      }).catch(err => this.error(err));
    }
  }

  async init() {
    this.tryConnect();
  }

  async uninit() {
    this.disconnect();
  }

  tryConnect(timeout = 0) {
    if (this.isConnected) return;

    this.log(`Trying to connect in ${timeout}ms...`);

    setTimeout(() => {
      this.disconnect();
      this.connect().catch(() => {
        this.tryConnect(5000);
      });
    }, timeout);
  }

  async connect() {
    await this.setUnavailable('Connecting...');

    try {
      const {
        deviceId,
        userId,
      } = this.getData();

      const {
        hostname,
        accessCode,
      } = this.getSettings();

      let mqttUrl;
      let mqttOptions = {};

      if (hostname) {
        mqttUrl = `mqtts://${hostname}`;
        mqttOptions.username = 'bblp';
        mqttOptions.password = accessCode;
        mqttOptions.rejectUnauthorized = false;
        mqttOptions.keepalive = 10;
      } else {
        mqttUrl = 'mqtts://us.mqtt.bambulab.com';
        mqttOptions.username = `u_${userId}`;
        mqttOptions.password = this.oAuth2Client.getToken().access_token;
      }

      // Connect
      await new Promise((resolve, reject) => {
        this.log(`Connecting to ${mqttUrl}...`);
        this.mqtt = mqtt.connect(mqttUrl, mqttOptions);
        this.mqtt.on('connect', () => {
          this.log('MQTT onConnect');
          resolve();
        });
        this.mqtt.on('end', () => {
          this.error('MQTT onEnd');
          reject(new Error('MQTT End'));
        });
        this.mqtt.on('error', err => {
          this.mqtt?.end();

          this.error(`MQTT onError: ${err.message}`);
          reject(err);
        });
      });

      // Subscribe
      this.log('Subscribing...');
      await this.mqtt.subscribeAsync(`device/${deviceId}/report`);
      this.log('Subscribed');

      // Handle Messages
      this.mqtt.on('message', (topic, message) => {
        if (topic !== `device/${deviceId}/report`) return;
        try {
          message = JSON.parse(message);
          BambuUtil.deepMergeInPlace(this.state, message);

          this.onState(message)
            .catch(err => this.error(`Error Handling State: ${err.message}`));
        } catch (err) {
          this.error(`Error Handling Message: ${err.message}`);
        }
      });

      // Request Full Status
      this.log('Requesting Full Status...');
      await this.mqtt.publishAsync(`device/${deviceId}/request`, JSON.stringify({
        pushing: {
          sequence_id: '0',
          command: 'pushall',
          version: 1,
          push_target: 1,
        },
      }));

      await this.setAvailable();
      this.isConnected = true;

      this.mqtt.on('offline', () => {
        this.mqtt?.end();

        this.error(`MQTT Offline`);
        this.setUnavailable('Offline').catch(this.error);

        this.isConnected = false;
        this.tryConnect(5000);
      });

      this.mqtt.on('error', err => {
        this.mqtt?.end();

        this.error(`MQTT Error: ${err.message}`);
        this.setUnavailable('Offline').catch(this.error);

        this.isConnected = false;
        this.tryConnect(5000);
      });
    } catch (err) {
      this.error(`Error Connecting: ${err.message}`);

      if (err.message === 'connack timeout') {
        err.message = 'Could not connect to the printer. Please check that the device is online.';
      }

      await this.setUnavailable(err);
      throw err;
    }
  }

  disconnect() {
    if (this.mqtt) {
      this.mqtt.removeAllListeners();
      this.mqtt.on('error', err => {
        this.error('Dangling Error Event', err);
      });
      this.mqtt?.end();
      this.mqtt = null;
    }

    this.isConnected = false;
  }

  async setLightChamber({
    on = true,
  }) {
    await this.publish({
      system: {
        sequence_id: '0',
        command: 'ledctrl',
        led_node: 'chamber_light',
        led_mode: on
          ? 'on'
          : 'off',
        led_on_time: 500,
        led_off_time: 500,
        loop_times: 1,
        interval_time: 1000,
      },
    });
  }

  async setLightWork({
    on = true,
  }) {
    await this.publish({
      system: {
        sequence_id: '0',
        command: 'ledctrl',
        led_node: 'work_light',
        led_mode: on
          ? 'on'
          : 'off',
        led_on_time: 500,
        led_off_time: 500,
        loop_times: 1,
        interval_time: 1000,
      },
    });
  }

  async setPrintPaused() {
    await this.publish({
      print: {
        sequence_id: '0',
        command: 'pause',
        param: '',
      },
    });
  }

  async setPrintResume() {
    await this.publish({
      print: {
        sequence_id: '0',
        command: 'resume',
        param: '',
      },
    });
  }

  async setPrintStop() {
    await this.publish({
      print: {
        sequence_id: '0',
        command: 'stop',
        param: '',
      },
    });
  }

  async setPrintSpeed({
    speed = BambuUtil.PrintSpeed.SILENT,
  }) {
    await this.publish({
      print: {
        sequence_id: '0',
        command: 'print_speed',
        param: speed,
      },
    });
  }

  async publish(obj) {
    if (!this.mqtt) {
      throw new Error('Not Connected');
    }

    await this.mqtt.publishAsync(`device/${this.getData().deviceId}/request`, JSON.stringify(obj), {
      qos: 1,
    });
  }

  async onState(state) {
    // this.log('State:', JSON.stringify(state));

    // Chamber Light
    const lightChamber = state?.print?.lights_report?.find(light => light.node === 'chamber_light');
    if (lightChamber) {
      if (!this.hasCapability('onoff.light_chamber')) {
        await this.addCapability('onoff.light_chamber');
        await this.setCapabilityOptions('onoff.light_chamber', {
          title: 'Chamber Light',
        });
      }

      await this.setCapabilityValue('onoff.light_chamber', lightChamber.mode === 'on')
        .catch(this.error);
    }

    // Work Light
    const lightWork = state?.print?.lights_report?.find(light => light.node === 'work_light');
    if (lightWork) {
      if (!this.hasCapability('onoff.light_work')) {
        await this.addCapability('onoff.light_work');
        await this.setCapabilityOptions('onoff.light_work', {
          title: 'Work Light',
        });
      }

      await this.setCapabilityValue('onoff.light_work', lightWork.mode === 'on')
        .catch(this.error);
    }

    // Temperature — Nozzle
    const temperatureNozzle = state?.print?.nozzle_temper;
    if (typeof temperatureNozzle === 'number') {
      if (!this.hasCapability('measure_temperature.nozzle')) {
        await this.addCapability('measure_temperature.nozzle');
        await this.setCapabilityOptions('measure_temperature.nozzle', {
          title: 'Nozzle Temperature',
        });
      }

      await this.setCapabilityValue('measure_temperature.nozzle', temperatureNozzle)
        .catch(this.error);
    }

    // Temperature — Bed
    const temperatureBed = state?.print?.bed_temper;
    if (typeof temperatureBed === 'number') {
      if (!this.hasCapability('measure_temperature.bed')) {
        await this.addCapability('measure_temperature.bed');
        await this.setCapabilityOptions('measure_temperature.bed', {
          title: 'Bed Temperature',
        });
      }

      await this.setCapabilityValue('measure_temperature.bed', temperatureBed)
        .catch(this.error);
    }

    // Temperature — Chamber
    const temperatureChamber = state?.print?.chamber_temper ?? state?.print?.device?.ctc?.info?.temp;
    if (typeof temperatureChamber === 'number') {
      if (!this.hasCapability('measure_temperature.chamber')) {
        await this.addCapability('measure_temperature.chamber');
        await this.setCapabilityOptions('measure_temperature.chamber', {
          title: 'Chamber Temperature',
        });
      }

      await this.setCapabilityValue('measure_temperature.chamber', temperatureChamber)
        .catch(this.error);
    }

    // Progress Percentage
    const progressPercent = state?.print?.mc_percent;
    if (progressPercent) {
      if (!this.hasCapability('bambu_progress_percentage')) {
        await this.addCapability('bambu_progress_percentage');
      }

      await this.setCapabilityValue('bambu_progress_percentage', progressPercent)
        .catch(this.error);
    }

    // Progress Remaining Time
    const progressRemaining = state?.print?.mc_remaining_time;
    if (typeof progressRemaining === 'number') {
      if (!this.hasCapability('bambu_progress_time_remaining')) {
        await this.addCapability('bambu_progress_time_remaining');
      }

      await this.setCapabilityValue('bambu_progress_time_remaining', `${progressRemaining} min`)
        .catch(this.error);
    }

    // Progress — Layers
    const progressLayers = state?.print?.layer_num;
    const progressLayersTotal = state?.print?.total_layer_num;
    if (typeof progressLayers === 'number' && typeof progressLayersTotal === 'number') {
      if (!this.hasCapability('bambu_print_layers')) {
        await this.addCapability('bambu_print_layers');
      }

      await this.setCapabilityValue('bambu_print_layers', `${progressLayers} / ${progressLayersTotal}`)
        .catch(this.error);
    }

    // Job
    if (state?.print?.job_id) {
      const previousJobId = this.jobId;
      this.jobId = state?.print?.job_id;

      // Fetch Job Task
      if (this.jobId !== previousJobId) {
        this.jobTask = await this.oAuth2Client.getTasks({
          deviceId: this.getData().deviceId,
        })
          .then(tasks => {
            const task = tasks.find(task => String(task.id) === String(this.jobId));
            if (!task) return null;

            // Download the Cover
            if (task.cover) {
              this.jobImage = fetch(task.cover)
                .then(res => {
                  if (!res.ok) throw new Error(`Error Downloading Cover: ${res.statusText}`);
                  return res.buffer();
                });
              this.jobImage.catch(err => this.error(`Error Downloading Cover: ${err.message}`));
            }

            return task;
          })
          .catch(err => {
            this.error(`Error Getting Task: ${err.message}`);
            return null;
          });
      }
    }

    if (state?.print?.subtask_name) {
      this.jobName = state?.print?.subtask_name;
    }

    // Print State
    if (state?.print?.gcode_state) {
      if (this.printState !== state.print.gcode_state) {
        const previousPrintState = this.printState;
        this.printState = state.print.gcode_state;

        this.log(`New Print State: ${this.printState} — Old Print State: ${previousPrintState}`);

        // Start Flows
        if (previousPrintState !== null) {
          if (this.printState === BambuUtil.PrintStates.FAILED) {
            this.homey.flow
              .getDeviceTriggerCard('print_state_failed')
              .trigger(this, {
                print_error: String(this.state.print?.print_error ?? 'n/a'),
                mc_print_error_code: String(this.state.print?.mc_print_error_code ?? 'n/a'),
              })
              .catch(this.error);
          }

          if (this.printState === BambuUtil.PrintStates.FINISH) {
            this.homey.flow
              .getDeviceTriggerCard('print_state_finish')
              .trigger(this)
              .catch(this.error);
          }

          if (this.printState === BambuUtil.PrintStates.PAUSE) {
            this.homey.flow
              .getDeviceTriggerCard('print_state_paused')
              .trigger(this)
              .catch(this.error);
          }

          if (this.printState === BambuUtil.PrintStates.RUNNING) {
            this.homey.flow
              .getDeviceTriggerCard('print_state_running')
              .trigger(this)
              .catch(this.error);
          }
        }
      }
    }

    // Print Speed
    const printSpeed = state?.print?.spd_lvl;
    if (typeof printSpeed === 'number') {
      if (!this.hasCapability('bambu_print_speed')) {
        await this.addCapability('bambu_print_speed');
      }

      await this.setCapabilityValue('bambu_print_speed', String(printSpeed))
        .catch(this.error);
    }

    // Nozzle Target Temperature
    if (typeof state?.print?.nozzle_target_temper === 'number') {
      if (!this.hasCapability('measure_temperature.nozzle_target')) {
        await this.addCapability('measure_temperature.nozzle_target');
        await this.setCapabilityOptions('measure_temperature.nozzle_target', {
          title: 'Nozzle Target Temperature',
        });
      }

      await this.setCapabilityValue('measure_temperature.nozzle_target', state.print.nozzle_target_temper)
        .catch(this.error);
    }

    // Bed Target Temperature
    if (typeof state?.print?.bed_target_temper === 'number') {
      if (!this.hasCapability('measure_temperature.bed_target')) {
        await this.addCapability('measure_temperature.bed_target');
        await this.setCapabilityOptions('measure_temperature.bed_target', {
          title: 'Bed Target Temperature',
        });
      }

      await this.setCapabilityValue('measure_temperature.bed_target', state.print.bed_target_temper)
        .catch(this.error);
    }

    const hasCameraStreaming = typeof this.homey.hasFeature === 'function' && this.homey.hasFeature('camera-streaming') && this.homey.platform === 'local';
    // Register Video
    if (typeof state?.print?.ipcam?.rtsp_url === 'string' && !this.video && hasCameraStreaming) {
      this.video = Promise.resolve().then(async () => {
        this.video = await this.homey.videos.createVideoRTSP({
          allowInvalidCertificates: true
        });
        this.video.registerVideoUrlListener(async () => {
          try {
            if (state?.print?.ipcam?.rtsp_url === 'disable') {
              throw new Error('Please enable LAN Only Liveview on the printer.')
            }

            const { accessCode } = this.getSettings();
            if (!accessCode) {
              throw new Error('Please set the printer\'s Access Code in the device settings first to enable camera streaming.')
            }

            const url = new URL(state?.print?.ipcam?.rtsp_url);
            url.username = 'bblp';
            url.password = accessCode;
            this.log('Camera URL:', url.toString());

            return {
              url: url.toString(),
            };
          } catch (err) {
            this.error(`Error returning Video URL: ${err.message}`);
            throw err;
          }
        });
        await this.setCameraVideo('chamber', 'Chamber', this.video);
      }).catch(err => this.error(`Error creating camera: ${err.message}`));
    }
  }

}
