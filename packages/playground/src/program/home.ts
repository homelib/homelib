import {$home, Temperature, bootstrap} from '@homelib/core';
import {reaction} from '@homelib/core/mobx';
import {$xiaomi} from '@homelib/xiaomi';

type StateMatcherDefinition<TState, TInput> = {
  state: TState;
  enter: (input: TInput) => boolean;
  leave: (input: TInput) => boolean;
};

/**
 * 带滞回（hysteresis）的状态匹配器：
 * - 当前状态的 leave 条件不成立时保持原状态；
 * - 否则按定义顺序进入第一个 enter 条件成立的状态；
 * - 没有任何 enter 条件匹配时抛出运行时错误。
 *
 * 注意：enter 条件应覆盖整个输入空间（无匹配即报错）；leave 条件应比
 * enter 更宽松，形成缓冲带，避免数值跳动导致过于频繁的状态切换。
 */
class StateMatcher<TState, TInput> {
  private currentDefinition: StateMatcherDefinition<TState, TInput> | undefined;

  constructor(
    private readonly definitions: readonly StateMatcherDefinition<
      TState,
      TInput
    >[],
  ) {}

  get state(): TState | undefined {
    return this.currentDefinition?.state;
  }

  update(input: TInput): {state: TState; changed: boolean} {
    const {currentDefinition} = this;

    if (currentDefinition && !currentDefinition.leave(input)) {
      return {state: currentDefinition.state, changed: false};
    }

    this.currentDefinition = undefined;

    for (const definition of this.definitions) {
      if (definition === currentDefinition) {
        continue;
      }

      if (definition.enter(input)) {
        this.currentDefinition = definition;
        return {state: definition.state, changed: true};
      }
    }

    throw new Error(
      `No matching state for input ${JSON.stringify(input)}; previous state: ${String(currentDefinition?.state)}.`,
    );
  }
}

$xiaomi('美岸');

const 美岸 = $home('美岸');

const 餐厅 = 美岸.$scope('餐厅');
const 餐厅大灯 = 餐厅.$light('大灯');
const 餐厅小灯 = 餐厅.$light('小灯');

const 客厅 = 美岸.$scope('客厅');
const 客厅大灯 = 客厅.$light('大灯');
const 客厅小灯 = 客厅.$light('小灯');
const 客厅空调 = 客厅.$airConditioner('空调');
const 客厅除湿机 = 客厅.$dehumidifier('除湿机');

await bootstrap();

const IDEAL_APPARENT_TEMPERATURE_UPPER_LIMIT = 26;
const IDEAL_APPARENT_TEMPERATURE_LOWER_LIMIT = 20;

const TEMPERATURE_BACKOFF = 2;

const IDEAL_HUMIDITY_UPPER_LIMIT = 0.5;
const IDEAL_HUMIDITY_LOWER_LIMIT = 0.45;

const IDEAL_TEMPERATURE_DEVIATION = 0.5;
const IDEAL_HUMIDITY_DEVIATION = 0.02;

type LevelState = 'high' | 'ideal' | 'low';

let idealTemperatureUpperLimit = IDEAL_APPARENT_TEMPERATURE_UPPER_LIMIT;
let idealTemperatureLowerLimit = IDEAL_APPARENT_TEMPERATURE_LOWER_LIMIT;

const temperatureMatcher = new StateMatcher<LevelState, number>([
  {
    state: 'high',
    enter: temperature => temperature > idealTemperatureUpperLimit,
    leave: temperature =>
      temperature <= idealTemperatureUpperLimit - IDEAL_TEMPERATURE_DEVIATION,
  },
  {
    state: 'ideal',
    enter: temperature =>
      temperature <= idealTemperatureUpperLimit &&
      temperature >= idealTemperatureLowerLimit,
    leave: temperature =>
      temperature > idealTemperatureUpperLimit ||
      temperature < idealTemperatureLowerLimit,
  },
  {
    state: 'low',
    enter: temperature => temperature < idealTemperatureLowerLimit,
    leave: temperature =>
      temperature >= idealTemperatureLowerLimit + IDEAL_TEMPERATURE_DEVIATION,
  },
]);

const humidityMatcher = new StateMatcher<LevelState, number>([
  {
    state: 'high',
    enter: humidity => humidity > IDEAL_HUMIDITY_UPPER_LIMIT,
    leave: humidity =>
      humidity <= IDEAL_HUMIDITY_UPPER_LIMIT - IDEAL_HUMIDITY_DEVIATION,
  },
  {
    state: 'ideal',
    enter: humidity =>
      humidity <= IDEAL_HUMIDITY_UPPER_LIMIT &&
      humidity >= IDEAL_HUMIDITY_LOWER_LIMIT,
    leave: humidity =>
      humidity > IDEAL_HUMIDITY_UPPER_LIMIT ||
      humidity < IDEAL_HUMIDITY_LOWER_LIMIT,
  },
  {
    state: 'low',
    enter: humidity => humidity < IDEAL_HUMIDITY_LOWER_LIMIT,
    leave: humidity =>
      humidity >= IDEAL_HUMIDITY_LOWER_LIMIT + IDEAL_HUMIDITY_DEVIATION,
  },
]);

reaction(
  () =>
    客厅空调.ready && 客厅除湿机.ready
      ? {
          temperature: 客厅除湿机.temperature?.celsius,
          humidity: 客厅除湿机.humidity,
        }
      : {},
  ({temperature, humidity}) => {
    if (temperature === undefined || humidity === undefined) {
      return;
    }

    const nextIdealTemperatureUpperLimit =
      getTemperatureByApparentTemperatureAndHumidity(
        IDEAL_APPARENT_TEMPERATURE_UPPER_LIMIT,
        humidity,
      );
    const nextIdealTemperatureLowerLimit =
      getTemperatureByApparentTemperatureAndHumidity(
        IDEAL_APPARENT_TEMPERATURE_LOWER_LIMIT,
        humidity,
      );

    const idealTemperatureLimitsChanged =
      Math.abs(nextIdealTemperatureUpperLimit - idealTemperatureUpperLimit) >
        IDEAL_TEMPERATURE_DEVIATION ||
      Math.abs(nextIdealTemperatureLowerLimit - idealTemperatureLowerLimit) >
        IDEAL_TEMPERATURE_DEVIATION;

    idealTemperatureUpperLimit = nextIdealTemperatureUpperLimit;
    idealTemperatureLowerLimit = nextIdealTemperatureLowerLimit;

    console.info({
      temperature,
      humidity,
      idealTemperatureUpperLimit,
      idealTemperatureLowerLimit,
    });

    const temperatureState = temperatureMatcher.update(temperature);
    const humidityState = humidityMatcher.update(humidity);

    if (
      !temperatureState.changed &&
      !humidityState.changed &&
      !idealTemperatureLimitsChanged
    ) {
      return;
    }

    console.info({temperatureState, humidityState});

    if (temperatureState.state === 'high' && humidityState.state === 'high') {
      客厅空调.setMode('dry').setTargetHumidity(IDEAL_HUMIDITY_UPPER_LIMIT);

      客厅除湿机.ensureOn().setTargetHumidity(1);
    } else if (temperatureState.state === 'high') {
      客厅空调
        .setMode('cool')
        .setTargetTemperature(
          Temperature.fromCelsius(idealTemperatureUpperLimit),
        );
    } else if (humidityState.state === 'high') {
      客厅空调
        .setMode('cool')
        .setTargetTemperature(
          Temperature.fromCelsius(
            idealTemperatureUpperLimit + TEMPERATURE_BACKOFF,
          ),
        );

      客厅除湿机.ensureOn().setTargetHumidity(IDEAL_HUMIDITY_UPPER_LIMIT);
    } else if (
      temperatureState.state === 'low' &&
      humidityState.state === 'low'
    ) {
      客厅空调
        .setMode('heat')
        .setTargetTemperature(
          Temperature.fromCelsius(idealTemperatureLowerLimit),
        );

      客厅除湿机.ensureOn().setTargetHumidity(1);
    } else if (temperatureState.state === 'low') {
      客厅空调
        .setMode('heat')
        .setTargetTemperature(
          Temperature.fromCelsius(idealTemperatureLowerLimit),
        );

      客厅除湿机.ensureOn().setTargetHumidity(1);
    } else if (humidityState.state === 'low') {
      客厅空调
        .setMode('heat')
        .setTargetTemperature(
          Temperature.fromCelsius(
            idealTemperatureLowerLimit - TEMPERATURE_BACKOFF,
          ),
        );

      客厅除湿机.ensureOn().setTargetHumidity(1);
    } else {
      switch (客厅空调.mode) {
        case 'dry':
          break;
        case 'cool':
          客厅空调.setTargetTemperature(
            Temperature.fromCelsius(
              idealTemperatureUpperLimit + TEMPERATURE_BACKOFF,
            ),
          );

          客厅除湿机.ensureOn().setTargetHumidity(IDEAL_HUMIDITY_UPPER_LIMIT);
          break;
        case 'heat':
          客厅空调.setTargetTemperature(
            Temperature.fromCelsius(
              idealTemperatureLowerLimit - TEMPERATURE_BACKOFF,
            ),
          );

          客厅除湿机.ensureOn().setTargetHumidity(1);
          break;
      }
    }
  },
  {
    fireImmediately: true,
  },
);

function getTemperatureByApparentTemperatureAndHumidity(
  apparentTemperature: number,
  humidity: number,
): number {
  // 体感温度(AT) = 气温(T) - 4.00 + 2.01696 * rh * exp((17.67 * T) / (T + 243.5))

  // --- 公式常量 ---
  const C = 2.01696; // 0.33 * 6.112 的合并常数
  const A = 17.67;
  const B = 243.5;
  const D = A * B; // 4302.645，用于导数计算

  // 边界情况：湿度为 0 时，公式退化为 AT = T - 4，直接求解
  if (humidity <= 1e-12) {
    return apparentTemperature + 4.0;
  }

  // --- 1. 智能估算初始值 ---
  // 湿热环境下，真实气温通常高于体感温度
  let temperature: number;

  if (apparentTemperature > 30) {
    temperature = apparentTemperature + 2.5;
  } else if (apparentTemperature > 10) {
    temperature = apparentTemperature + 4.0;
  } else {
    temperature = Math.max(apparentTemperature + 5, 5); // 低温时给一个保底正值
  }

  // --- 2. 牛顿迭代法求解 ---
  const maxIter = 200;
  const tolerance = 1e-9;

  for (let i = 0; i < maxIter; i++) {
    // 计算指数参数和指数值
    const expArg = (A * temperature) / (temperature + B);
    const expVal = Math.exp(expArg);

    // 定义方程 F(T) = T - 4 - AT + C * rh * expVal = 0
    const F = temperature - 4.0 - apparentTemperature + C * humidity * expVal;

    // 检查是否已经收敛到足够精度
    if (Math.abs(F) < tolerance) {
      return temperature;
    }

    // 计算导数 F'(T) = 1 + C * rh * expVal * (A*B) / (T+B)^2
    const dF =
      1.0 +
      (C * humidity * expVal * D) / ((temperature + B) * (temperature + B));

    // 防止导数过小（理论上该函数导数恒 > 1，这里做防御）
    if (Math.abs(dF) < 1e-15) {
      break;
    }

    // 牛顿核心步骤：T_new = T_old - F / F'
    const nextTemperature = temperature - F / dF;

    // 物理约束：气温不能低于绝对零度，也不能高得太离谱（通常不会）
    if (nextTemperature < -273.15) {
      temperature = -273.15 + 1e-6;
    } else {
      temperature = nextTemperature;
    }
  }

  // 如果循环结束仍未收敛，返回 NaN（实际情况下极少发生）
  return temperature;
}
