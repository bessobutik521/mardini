export function calculate(input, config) {
  const service = config.services.find(s => s.id === input.service);
  if (!config.settings.active) throw new Error('المنصة متوقفة مؤقتًا. يرجى المحاولة لاحقًا.');
  if (!service?.active) throw new Error('هذه الخدمة متوقفة مؤقتًا.');

  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1e12) throw new Error('أدخل مبلغًا صحيحًا أكبر من صفر.');

  const rates = config.rates || { buyUsd: config.rate, sellUsd: config.rate };
  const buyUsd = Number(rates.buyUsd);
  const sellUsd = Number(rates.sellUsd);
  if (!(buyUsd > 0) || !(sellUsd > 0)) throw new Error('أسعار الصرف غير صالحة.');

  if (service.id === 'exchange') {
    if (!service.directions.includes(input.direction)) throw new Error('اختر اتجاه صرف متاحًا.');
    const currency = input.direction === 'usd-syp' ? 'USD' : 'SYP';
    if (!service.currencies.includes(currency)) throw new Error('هذه العملة غير متاحة.');
    const rate = input.direction === 'usd-syp' ? sellUsd : buyUsd;
    const base = currency === 'SYP' ? amount / rate : amount;
    if (base < Number(service.minimum || 0)) throw new Error(`الحد الأدنى لهذه العملية هو ${service.minimum} دولار.`);
    if (service.maximum != null && base > Number(service.maximum)) throw new Error(`الحد الأقصى لهذه العملية هو ${service.maximum} دولار.`);
    const finalAmount = currency === 'USD' ? amount * rate : amount / rate;
    return { amount, currency, finalCurrency: currency === 'USD' ? 'SYP' : 'USD', commission: 0, networkFee: 0, rate, finalAmount, commissionType: 'none' };
  }

  if (!service.directions.includes(input.direction) || !service.currencies.includes(input.balance)) throw new Error('يرجى اختيار اتجاه وعملة متاحين.');
  const currency = input.direction === 'sell' ? 'USDT' : input.balance;
  const finalCurrency = input.direction === 'sell' ? input.balance : 'USDT';
  const base = currency === 'SYP' ? amount / buyUsd : amount;
  if (base < Number(service.minimum || 0)) throw new Error(`الحد الأدنى لهذه العملية هو ${service.minimum} دولار/USDT.`);
  if (service.maximum != null && base > Number(service.maximum)) throw new Error(`الحد الأقصى لهذه العملية هو ${service.maximum} دولار/USDT.`);

  let commission = 0, networkFee = 0;
  if (input.direction === 'sell') {
    const tier = config.tiers
      .filter(t => t.active && (t.direction == null || t.direction === 'sell'))
      .sort((a,b) => Number(a.minimum) - Number(b.minimum))
      .find(t => base >= Number(t.minimum) && (t.maximum == null || base <= Number(t.maximum)));
    if (!tier) throw new Error('لا توجد شريحة عمولة بيع لهذا المبلغ.');
    commission = Number(tier.fixed_amount || 0);
    if (!Number.isFinite(commission) || commission < 0) throw new Error('عمولة البيع غير صالحة.');
  } else {
    const net = config.networks.find(n => String(n.id) === String(input.network));
    if (!net) throw new Error('اختر شبكة التحويل.');
    networkFee = Number(net.buy_fee || 0);
    if (!Number.isFinite(networkFee) || networkFee < 0) throw new Error('رسوم الشبكة غير صالحة.');
  }

  const netBase = base - commission - networkFee;
  if (netBase <= 0) throw new Error('المبلغ أقل من الرسوم المطلوبة.');
  const finalAmount = input.direction === 'sell' ? (finalCurrency === 'SYP' ? netBase * sellUsd : netBase) : netBase;
  const rate = input.direction === 'sell' ? sellUsd : buyUsd;
  return { amount, currency, finalCurrency, commission, networkFee, rate, finalAmount, commissionType: 'fixed' };
}
