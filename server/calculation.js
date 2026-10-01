export function calculate(input, config) {
  const service = config.services.find(s => s.id === input.service);
  if (!config.settings.active) throw new Error('المنصة متوقفة مؤقتًا. يرجى المحاولة لاحقًا.');
  if (!service?.active) throw new Error('هذه الخدمة متوقفة مؤقتًا.');
  if (!service.directions.includes(input.direction)) throw new Error('يرجى اختيار اتجاه متاح.');
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1e12) throw new Error('أدخل مبلغًا صحيحًا أكبر من صفر.');
  const rate = config.rate;
  let currency, finalCurrency, base;
  if (service.id === 'usdt') {
    if (!service.currencies.includes(input.balance)) throw new Error('يرجى اختيار عملة متاحة.');
    currency = input.direction === 'sell' ? 'USDT' : input.balance;
    finalCurrency = input.direction === 'sell' ? input.balance : 'USDT';
    base = currency === 'SYP' ? amount / rate : amount;
  } else {
    currency = input.direction === 'usd-syp' ? 'USD' : 'SYP';
    finalCurrency = currency === 'USD' ? 'SYP' : 'USD';
    if (!service.currencies.includes(currency) || !service.currencies.includes(finalCurrency)) throw new Error('عملة هذا الاتجاه متوقفة مؤقتًا.');
    base = currency === 'SYP' ? amount / rate : amount;
  }
  const unit = service.id === 'usdt' ? 'USDT' : 'دولار';
  if (base < service.minimum) throw new Error(`الحد الأدنى لهذه العملية هو ${service.minimum} ${unit}${currency === 'SYP' ? `، أي ${service.minimum * rate} ليرة سورية` : ''}.`);
  if (service.maximum != null && base > service.maximum) throw new Error(`الحد الأقصى لهذه العملية هو ${service.maximum} ${unit}.`);
  const tier = config.tiers.filter(t => t.active && base >= t.minimum && (t.maximum == null || base <= t.maximum)).sort((a,b) => a.minimum - b.minimum)[0];
  if (service.id === 'usdt' && !tier) throw new Error('لا توجد شريحة عمولة لهذا المبلغ. يرجى التواصل مع الدعم.');
  const commissionType = service.id === 'usdt' ? (tier.type || 'percent') : 'none';
  const percent = commissionType === 'percent' ? tier.percent : 0;
  const fixedAmount = commissionType === 'fixed' ? Number(tier.fixed_amount) : 0;
  if (commissionType === 'fixed' && (!Number.isFinite(fixedAmount) || fixedAmount < 0)) throw new Error('قيمة العمولة الثابتة غير صالحة. يرجى التواصل مع الدعم.');
  if (commissionType === 'fixed' && fixedAmount >= base) throw new Error('يجب أن يكون مبلغ العملية أكبر من العمولة الثابتة.');
  const commission = Math.round((commissionType === 'fixed' ? fixedAmount * (currency === 'SYP' ? rate : 1) : amount * percent / 100) * 1e6) / 1e6;
  const netBase = commissionType === 'fixed' ? base - fixedAmount : base * (1 - percent / 100);
  const finalAmount = Math.floor((netBase * (finalCurrency === 'SYP' ? rate : 1) + 1e-9) * (finalCurrency === 'SYP' ? 1 : 1e6)) / (finalCurrency === 'SYP' ? 1 : 1e6);
  if (commissionType === 'fixed' && (commission >= amount || finalAmount <= 0)) throw new Error('المبلغ المتبقي بعد خصم العمولة صغير جدًا. يرجى زيادة المبلغ.');
  return { amount, currency, finalCurrency, commission, percent, rate, finalAmount, commissionType, fixedAmount };
}
