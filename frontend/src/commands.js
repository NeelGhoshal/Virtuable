// What someone says is either a command or a chat message.
const COMMANDS = [
  ['unmute', /^(unmute( me)?|turn (my )?(mic|microphone) on|(mic|microphone) on)$/],
  ['mute', /^(mute( me)?|turn (my )?(mic|microphone) off|(mic|microphone) off)$/],
  ['lower', /^(lower|put down) (my )?hand$/],
  ['raise', /^(raise|put up) (my )?hand$/],
  ['agree', /^(i agree|agree)$/],
];

export function parseSpeech(text) {
  const spoken = text.trim();
  if (!spoken) return null;
  const plain = spoken
    .toLowerCase()
    .replace(/[.,!?]/g, '')
    .replace(/\bun mute\b/, 'unmute')
    .trim();
  const hit = COMMANDS.find(([, pattern]) => pattern.test(plain));
  return hit ? { command: hit[0] } : { message: spoken };
}
