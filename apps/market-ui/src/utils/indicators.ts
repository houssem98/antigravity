export const calculateSMA = (data: any[], period: number) => {
  const smaData = [];
  for (let i = period - 1; i < data.length; i++) {
    let sum = 0;
    for (let j = 0; j < period; j++) {
      sum += data[i - j].close;
    }
    smaData.push({ time: data[i].time, value: sum / period });
  }
  return smaData;
};

export const calculateEMA = (data: any[], period: number) => {
  const emaData = [];
  const k = 2 / (period + 1);
  let ema = data[0].close;
  
  for (let i = 0; i < data.length; i++) {
    ema = (data[i].close - ema) * k + ema;
    if (i >= period - 1) {
      emaData.push({ time: data[i].time, value: ema });
    }
  }
  return emaData;
};

export const calculateRSI = (data: any[], period: number = 14) => {
  const rsiData = [];
  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i++) {
    const change = data[i].close - data[i - 1].close;
    if (change >= 0) {
      gains += change;
    } else {
      losses -= change;
    }
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period; i < data.length; i++) {
    if (i > period) {
      const change = data[i].close - data[i - 1].close;
      let gain = 0;
      let loss = 0;
      if (change >= 0) {
        gain = change;
      } else {
        loss = -change;
      }
      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
    }

    let rs = avgGain / avgLoss;
    let rsi = avgLoss === 0 ? 100 : 100 - (100 / (1 + rs));
    rsiData.push({ time: data[i].time, value: rsi });
  }
  return rsiData;
};

export const calculateMACD = (data: any[], fastPeriod: number = 12, slowPeriod: number = 26, signalPeriod: number = 9) => {
  const fastEMA = calculateEMA(data, fastPeriod);
  const slowEMA = calculateEMA(data, slowPeriod);
  
  const macdLine = [];
  void (slowPeriod - 1); // startIndex unused
  
  for (let i = 0; i < slowEMA.length; i++) {
    const fastIndex = i + (slowPeriod - fastPeriod);
    if (fastEMA[fastIndex]) {
      macdLine.push({
        time: slowEMA[i].time,
        value: fastEMA[fastIndex].value - slowEMA[i].value
      });
    }
  }
  
  const signalLine = calculateEMA(macdLine.map(m => ({ time: m.time, close: m.value })), signalPeriod);
  
  const histogram = [];
  for (let i = 0; i < signalLine.length; i++) {
    const macdIndex = i + (signalPeriod - 1);
    if (macdLine[macdIndex]) {
      histogram.push({
        time: signalLine[i].time,
        value: macdLine[macdIndex].value - signalLine[i].value
      });
    }
  }
  
  return { macdLine, signalLine, histogram };
};
