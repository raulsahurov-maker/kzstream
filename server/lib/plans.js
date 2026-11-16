// Тарифы KZStream и их ограничения
const PLANS = {
  free: {
    id: 'free', name: 'Free', price: 0,
    storageMB: 10, maxDuration: 6, tts: false, ttsAdvanced: false, voice: false,
    nicks: false, ads: true, info: false, timer: false, shop: false, roulette: false,
    tiktok: false, media: 0, hotkeys: false, webhooks: false, memes: false, freezeDays: 0,
  },
  lite: {
    id: 'lite', name: 'Lite', price: 2690,
    storageMB: 50, maxDuration: 30, tts: true, ttsAdvanced: false, voice: true,
    nicks: true, ads: false, info: true, timer: true, shop: true, roulette: true,
    tiktok: true, media: 50, hotkeys: false, webhooks: false, memes: false, freezeDays: 5,
  },
  pro: {
    id: 'pro', name: 'Pro', price: 7190,
    storageMB: 100, maxDuration: 60, tts: true, ttsAdvanced: true, voice: true,
    nicks: true, ads: false, info: true, timer: true, shop: true, roulette: true,
    tiktok: true, media: Infinity, hotkeys: true, webhooks: true, memes: true, freezeDays: 10,
  },
};

function effectivePlan(user) {
  if (!user) return PLANS.free;
  if (user.plan !== 'free' && user.plan_until && user.plan_until > Date.now()) return PLANS[user.plan] || PLANS.free;
  return PLANS.free;
}

module.exports = { PLANS, effectivePlan };
