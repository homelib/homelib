import {
  type AirConditioner,
  type Dehumidifier,
  type HumiditySensor,
  Temperature,
  type TemperatureSensor,
} from '@homelib/core';
import {autorun} from '@homelib/core/mobx';
import {
  StateMatcher,
  getTemperatureByApparentTemperatureAndRelativeHumidity,
} from '@homelib/utils';
import _ from 'lodash';

const VERY_HIGH_TEMPERATURE_OFFSET = 2;

const DRY_MODE_FAN_SPEED_TEMPERATURE_DIFFERENCE = 2;
const COOL_MODE_FAN_SPEED_TEMPERATURE_DIFFERENCE = 4;
const HEAT_MODE_FAN_SPEED_TEMPERATURE_DIFFERENCE = 4;

// 很多垃圾空调到了指定温度后还会继续制冷，所以需要一个后退值。
const TEMPERATURE_BACKOFF = 4;

export function setupTemperatureHumidityControl(
  name: string,
  {
    airConditioner,
    dehumidifier,
    onGetter = () => true,
    temperature: {
      sensor: temperatureSensor,
      idealApparentTemperatureUpperLimit,
      idealApparentTemperatureLowerLimit,
      idealTemperatureTolerance,
    },
    humidity: {
      sensor: humiditySensor,
      idealRelativeHumidityUpperLimit,
      idealRelativeHumidityLowerLimit,
      idealRelativeHumidityTolerance,
    },
  }: {
    airConditioner: AirConditioner;
    dehumidifier: Dehumidifier;
    onGetter?: () => boolean | undefined;
    temperature: {
      sensor: TemperatureSensor;
      idealApparentTemperatureUpperLimit: number;
      idealApparentTemperatureLowerLimit: number;
      idealTemperatureTolerance: number;
    };
    humidity: {
      sensor: HumiditySensor;
      idealRelativeHumidityUpperLimit: number;
      idealRelativeHumidityLowerLimit: number;
      idealRelativeHumidityTolerance: number;
    };
  },
): void {
  let idealTemperatureUpperLimit = idealApparentTemperatureUpperLimit;
  let idealTemperatureLowerLimit = idealApparentTemperatureLowerLimit;

  const temperatureMatcher = new StateMatcher<
    'very-high' | 'high' | 'ideal' | 'low',
    number
  >([
    {
      state: 'very-high',
      enter: temperature =>
        temperature >=
        idealTemperatureUpperLimit + VERY_HIGH_TEMPERATURE_OFFSET,
      leave: temperature =>
        temperature <= idealTemperatureUpperLimit - idealTemperatureTolerance,
    },
    {
      state: 'high',
      enter: temperature => temperature >= idealTemperatureUpperLimit,
      leave: temperature =>
        temperature >
          idealTemperatureUpperLimit +
            VERY_HIGH_TEMPERATURE_OFFSET +
            idealTemperatureTolerance ||
        temperature < idealTemperatureUpperLimit - idealTemperatureTolerance,
    },
    {
      state: 'ideal',
      enter: temperature => temperature >= idealTemperatureLowerLimit,
      leave: temperature =>
        temperature > idealTemperatureUpperLimit + idealTemperatureTolerance ||
        temperature < idealTemperatureLowerLimit - idealTemperatureTolerance,
    },
    {
      state: 'low',
      enter: _temperature => true,
      leave: temperature =>
        temperature > idealTemperatureLowerLimit + idealTemperatureTolerance,
    },
  ]);

  const relativeHumidityMatcher = new StateMatcher<
    'high' | 'ideal' | 'low',
    number
  >([
    {
      state: 'high',
      enter: relativeHumidity =>
        relativeHumidity >= idealRelativeHumidityUpperLimit,
      leave: relativeHumidity =>
        relativeHumidity <
        idealRelativeHumidityUpperLimit - idealRelativeHumidityTolerance,
    },
    {
      state: 'ideal',
      enter: relativeHumidity =>
        relativeHumidity >= idealRelativeHumidityLowerLimit,
      leave: relativeHumidity =>
        relativeHumidity >
          idealRelativeHumidityUpperLimit + idealRelativeHumidityTolerance ||
        relativeHumidity <
          idealRelativeHumidityLowerLimit - idealRelativeHumidityTolerance,
    },
    {
      state: 'low',
      enter: _relativeHumidity => true,
      leave: relativeHumidity =>
        relativeHumidity >
        idealRelativeHumidityLowerLimit + idealRelativeHumidityTolerance,
    },
  ]);

  autorun(() => {
    if (
      !airConditioner.ready ||
      !dehumidifier.ready ||
      !temperatureSensor.ready ||
      !humiditySensor.ready
    ) {
      return;
    }

    const on = onGetter();

    if (on === undefined) {
      return;
    }

    if (!on) {
      airConditioner.turnOff();
      dehumidifier.turnOff();
      return;
    }

    const temperature = temperatureSensor.temperature?.celsius;
    const relativeHumidity = humiditySensor.relativeHumidity;

    if (temperature === undefined || relativeHumidity === undefined) {
      return;
    }

    airConditioner.turnOn();
    dehumidifier.turnOn();

    const nextIdealTemperatureUpperLimit =
      getTemperatureByApparentTemperatureAndRelativeHumidity(
        idealApparentTemperatureUpperLimit,
        relativeHumidity,
      );
    const nextIdealTemperatureLowerLimit =
      getTemperatureByApparentTemperatureAndRelativeHumidity(
        idealApparentTemperatureLowerLimit,
        relativeHumidity,
      );

    idealTemperatureUpperLimit = nextIdealTemperatureUpperLimit;
    idealTemperatureLowerLimit = nextIdealTemperatureLowerLimit;

    const temperatureState = temperatureMatcher.update(temperature);
    const relativeHumidityState =
      relativeHumidityMatcher.update(relativeHumidity);

    console.info(name, {
      temperature,
      relativeHumidity,
      idealTemperatureUpperLimit,
      idealTemperatureLowerLimit,
      temperatureState,
      relativeHumidityState,
    });

    const setAirConditionerDryMode = (): void => {
      airConditioner
        .setMode('dry')
        .setTargetHumidity(idealRelativeHumidityLowerLimit)
        .setFanSpeed(
          _.clamp(
            (temperature - idealTemperatureUpperLimit) /
              DRY_MODE_FAN_SPEED_TEMPERATURE_DIFFERENCE,
            0,
            1,
          ),
        );
    };

    const setAirConditionerCoolMode = (targetTemperature: number): void => {
      airConditioner
        .setMode('cool')
        .setTargetTemperature(Temperature.fromCelsius(targetTemperature))
        .setFanSpeed(
          _.clamp(
            (temperature - idealTemperatureUpperLimit) /
              COOL_MODE_FAN_SPEED_TEMPERATURE_DIFFERENCE,
            0,
            1,
          ),
        );
    };

    const setAirConditionerHeatMode = (targetTemperature: number): void => {
      airConditioner
        .setMode('heat')
        .setTargetTemperature(Temperature.fromCelsius(targetTemperature))
        .setFanSpeed(
          _.clamp(
            (idealTemperatureLowerLimit - temperature) /
              HEAT_MODE_FAN_SPEED_TEMPERATURE_DIFFERENCE,
            0,
            1,
          ),
        );
    };

    const setDehumidifierSoftOnOff = (on: boolean): void => {
      dehumidifier.setTargetHumidity(on ? idealRelativeHumidityLowerLimit : 1);
    };

    if (
      (temperatureState.state === 'high' ||
        temperatureState.state === 'very-high') &&
      relativeHumidityState.state === 'high'
    ) {
      if (temperatureState.state === 'very-high') {
        setAirConditionerCoolMode(idealTemperatureLowerLimit);
      } else {
        setAirConditionerDryMode();
      }

      setDehumidifierSoftOnOff(false);
    } else if (
      temperatureState.state === 'high' ||
      temperatureState.state === 'very-high'
    ) {
      setAirConditionerCoolMode(idealTemperatureLowerLimit);

      setDehumidifierSoftOnOff(true);
    } else if (relativeHumidityState.state === 'high') {
      setAirConditionerCoolMode(
        idealTemperatureUpperLimit + TEMPERATURE_BACKOFF,
      );

      setDehumidifierSoftOnOff(true);
    } else if (
      temperatureState.state === 'low' &&
      relativeHumidityState.state === 'low'
    ) {
      airConditioner
        .setMode('heat')
        .setTargetTemperature(
          Temperature.fromCelsius(idealTemperatureUpperLimit),
        );

      setDehumidifierSoftOnOff(false);
    } else if (temperatureState.state === 'low') {
      setAirConditionerHeatMode(idealTemperatureUpperLimit);

      setDehumidifierSoftOnOff(false);
    } else if (relativeHumidityState.state === 'low') {
      setAirConditionerHeatMode(
        idealTemperatureLowerLimit - TEMPERATURE_BACKOFF,
      );

      setDehumidifierSoftOnOff(false);
    } else {
      switch (airConditioner.mode) {
        case 'dry':
        case 'cool':
          setAirConditionerCoolMode(
            idealTemperatureUpperLimit + TEMPERATURE_BACKOFF,
          );

          setDehumidifierSoftOnOff(true);

          break;
        case 'heat':
          airConditioner.setTargetTemperature(
            Temperature.fromCelsius(
              idealTemperatureLowerLimit - TEMPERATURE_BACKOFF,
            ),
          );

          setDehumidifierSoftOnOff(false);

          break;
      }
    }
  });
}
