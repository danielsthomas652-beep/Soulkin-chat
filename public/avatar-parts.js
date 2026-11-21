'use strict';
/* mLT. chat — avatar parts: THE one shared whitelist for the avatar
 * maker. This single module is loaded by the browser (as the global
 * `AvatarParts`, via a plain <script> tag before app.js) AND required
 * by the server (server/index.js) to validate PATCH /api/me avatar
 * payloads. If a value isn't in these tables, it doesn't exist — the
 * client renderer only ever draws from these constants, and the server
 * only ever stores configs built from them, so a stored avatar can
 * never smuggle markup into anyone's page.
 *
 * A config is a compact JSON object of enum keys:
 *   { skin, hair, hairColor, mouth, facialHair,
 *     outfit, outfitColor, hat, glasses, bg }
 *
 * Art templates are SVG fragments on a 100x100 canvas. They use color
 * tokens the renderer substitutes with whitelisted hex values:
 *   {hc} hair color · {oc} outfit color · {od} outfit, darkened ·
 *   {ol} outfit, lightened · {sk} skin tone
 * Every other color is baked into the template itself. */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AvatarParts = api;
})(typeof self !== 'undefined' ? self : this, function () {

  /* ---------- color tables (option key -> hex) ---------- */
  const SKIN_TONES = {
    skin1: '#ffe3c2', skin2: '#f7cfa5', skin3: '#eab086',
    skin4: '#d69a68', skin5: '#a96f3f', skin6: '#71431f',
  };
  const HAIR_COLORS = {
    black: '#26221f', brown: '#7a4a21', blonde: '#f2c14e', ginger: '#e07b39',
    red: '#c1442e', pink: '#ef6fb0', blue: '#3a6fd8', green: '#2fa36b',
    purple: '#7b61c9', gray: '#b8bcc4', white: '#f4f4f6',
  };
  const OUTFIT_COLORS = {
    red: '#e23b4e', blue: '#3a6fd8', green: '#2fa36b', purple: '#7b61c9',
    orange: '#f07818', pink: '#ef6fb0', yellow: '#f5b921', teal: '#14b8a6',
    black: '#33333d', white: '#eef0f4',
  };

  /* ---------- backgrounds (static SVG, drawn first) ---------- */
  const BACKGROUNDS = {
    plain: '<rect width="100" height="100" fill="#dfe9f5"/>',
    sky: '<rect width="100" height="100" fill="#aee3ff"/><circle cx="83" cy="17" r="9" fill="#ffd93b"/><ellipse cx="24" cy="19" rx="11" ry="5" fill="#ffffff" opacity=".9"/><ellipse cx="33" cy="16" rx="8" ry="4.4" fill="#ffffff" opacity=".9"/><ellipse cx="70" cy="30" rx="9" ry="4.2" fill="#ffffff" opacity=".75"/>',
    sunset: '<rect width="100" height="100" fill="#ff9e5e"/><rect y="52" width="100" height="48" fill="#ff6b81"/><circle cx="50" cy="54" r="12" fill="#ffd93b"/><rect y="66" width="100" height="34" fill="#e23b4e" opacity=".45"/>',
    beach: '<rect width="100" height="100" fill="#aee3ff"/><rect y="54" width="100" height="46" fill="#ffe3ae"/><path d="M0 54 q12 -5 25 0 t25 0 t25 0 t25 0 v7 q-12 -5 -25 0 t-25 0 t-25 0 t-25 0 Z" fill="#ffffff" opacity=".85"/><circle cx="84" cy="15" r="8" fill="#ffd93b"/>',
    forest: '<rect width="100" height="100" fill="#bfe8c8"/><polygon points="2,100 15,54 28,100" fill="#2e7d4f"/><rect x="13" y="88" width="4" height="12" fill="#7a4a21"/><polygon points="70,100 85,48 99,100" fill="#2e7d4f"/><rect x="83" y="86" width="4" height="14" fill="#7a4a21"/><circle cx="50" cy="16" r="7" fill="#fff3b0"/>',
    rainbow: '<rect width="100" height="100" fill="#ffd93b"/><rect width="17" height="100" fill="#ef476f" opacity=".65"/><rect x="17" width="17" height="100" fill="#f78c6b" opacity=".65"/><rect x="50" width="17" height="100" fill="#06d6a0" opacity=".6"/><rect x="67" width="17" height="100" fill="#118ab2" opacity=".6"/><rect x="84" width="16" height="100" fill="#7b61c9" opacity=".6"/>',
    night: '<rect width="100" height="100" fill="#1d2a52"/><circle cx="81" cy="17" r="8" fill="#ffe9a3"/><circle cx="77" cy="14" r="6.6" fill="#1d2a52"/><circle cx="14" cy="14" r="1.6" fill="#ffffff"/><circle cx="30" cy="26" r="1.2" fill="#ffffff"/><circle cx="58" cy="10" r="1.4" fill="#ffffff"/><circle cx="20" cy="40" r="1.1" fill="#ffffff" opacity=".8"/><circle cx="90" cy="42" r="1.2" fill="#ffffff" opacity=".8"/>',
    space: '<rect width="100" height="100" fill="#141b3d"/><circle cx="12" cy="20" r="1.5" fill="#ffffff"/><circle cx="34" cy="10" r="1.1" fill="#ffffff"/><circle cx="62" cy="22" r="1.3" fill="#ffffff"/><circle cx="24" cy="34" r="1" fill="#ffffff" opacity=".8"/><circle cx="85" cy="76" r="9" fill="#b388ff"/><ellipse cx="85" cy="76" rx="15" ry="4" fill="none" stroke="#ffd93b" stroke-width="2" transform="rotate(-14 85 76)"/>',
    mint: '<rect width="100" height="100" fill="#b8f1d4"/><circle cx="16" cy="18" r="5" fill="#ffffff" opacity=".45"/><circle cx="86" cy="30" r="7" fill="#ffffff" opacity=".4"/><circle cx="24" cy="82" r="6" fill="#ffffff" opacity=".4"/><circle cx="80" cy="86" r="4" fill="#ffffff" opacity=".45"/>',
    pink: '<rect width="100" height="100" fill="#ffd3e6"/><circle cx="18" cy="24" r="5" fill="#ffffff" opacity=".5"/><circle cx="84" cy="16" r="6" fill="#ffffff" opacity=".45"/><circle cx="78" cy="84" r="5" fill="#ffffff" opacity=".5"/><circle cx="14" cy="78" r="4" fill="#ffffff" opacity=".45"/>',
    purple: '<rect width="100" height="100" fill="#cdbcf7"/><circle cx="20" cy="16" r="5" fill="#ffffff" opacity=".5"/><circle cx="84" cy="26" r="6" fill="#ffffff" opacity=".45"/><circle cx="26" cy="86" r="6" fill="#ffffff" opacity=".45"/><circle cx="82" cy="82" r="4" fill="#ffffff" opacity=".5"/>',
  };

  /* ---------- hair (back = behind the body/head, front = over the forehead) ---------- */
  const CAP = '<path d="M32.5 43 A17.5 17.5 0 0 1 67.5 43 L67.5 37.5 C59 30.5 41 30.5 32.5 37.5 Z" fill="{hc}"/>';
  const HAIR_ART = {
    none: { back: '', front: '' },
    buzz: { back: '', front: '<path d="M32.8 40 A17.4 17.4 0 0 1 67.2 40 A14.5 12.5 0 0 0 32.8 40 Z" fill="{hc}"/>' },
    short: { back: '', front: CAP },
    spiky: { back: '', front: '<path d="M32.5 44 L33.5 31 L39.5 37 L43.5 26.5 L48.5 34.5 L53.5 25.5 L57.5 34.5 L62.5 28.5 L65.5 37 L67.5 44 L60 37.5 C54.5 34.8 45.5 34.8 40 37.5 Z" fill="{hc}"/>' },
    mohawk: { back: '', front: '<path d="M43.5 35 C42.5 19 44.5 9 50 9 C55.5 9 57.5 19 56.5 35 C53.5 32 46.5 32 43.5 35 Z" fill="{hc}"/>' },
    curly: { back: '', front: '<circle cx="37" cy="30" r="5" fill="{hc}"/><circle cx="45" cy="25.5" r="5.6" fill="{hc}"/><circle cx="54" cy="25.5" r="5.6" fill="{hc}"/><circle cx="62" cy="30" r="5" fill="{hc}"/><path d="M32.5 42 A17.5 17.5 0 0 1 67.5 42 L67.5 36 C59 30 41 30 32.5 36 Z" fill="{hc}"/>' },
    wavy: { back: '', front: '<path d="M32.5 43 A17.5 17.5 0 0 1 67.5 43 L67.5 37 C62 31 57 38 52.5 33.5 C48 38.5 43 31 38 36.5 C35.5 39 33.5 40 32.5 40 Z" fill="{hc}"/>' },
    long: {
      back: '<path d="M28.5 72 L28.5 44 A21.5 21 0 0 1 71.5 44 L71.5 72 C71.5 76 65 76 64 71 L63 56 L37 56 L36 71 C35 76 28.5 76 28.5 72 Z" fill="{hc}"/>',
      front: CAP,
    },
    ponytail: {
      back: '<ellipse cx="71.5" cy="50" rx="5.5" ry="13" fill="{hc}" transform="rotate(14 71.5 50)"/><circle cx="66.5" cy="34" r="3.2" fill="#e23b4e"/>',
      front: CAP,
    },
    bun: { back: '', front: '<circle cx="50" cy="19.5" r="6.8" fill="{hc}"/>' + CAP },
  };

  /* ---------- faces: brows + mouth travel together ---------- */
  const BROW = 'fill="none" stroke="#503a28" stroke-width="1.7" stroke-linecap="round"';
  const MOUTH_INK = 'fill="none" stroke="#8a4b3a" stroke-width="2" stroke-linecap="round"';
  const MOUTH_ART = {
    smile: {
      brows: `<path d="M39 34.5 q4.5 -3 9 0" ${BROW}/><path d="M52 34.5 q4.5 -3 9 0" ${BROW}/>`,
      mouth: `<path d="M42.5 49 q7.5 6 15 0" ${MOUTH_INK}/>`,
    },
    grin: {
      brows: `<path d="M39 33 q4.5 -3.5 9 0" ${BROW}/><path d="M52 33 q4.5 -3.5 9 0" ${BROW}/>`,
      mouth: '<path d="M41 47.5 h18 c0 6.5 -4 10 -9 10 s-9 -3.5 -9 -10 Z" fill="#ffffff" stroke="#8a4b3a" stroke-width="1.8"/><path d="M41.5 52 h17" stroke="#8a4b3a" stroke-width="1.2"/>',
    },
    laugh: {
      brows: `<path d="M39 33 q4.5 -3.5 9 0" ${BROW}/><path d="M52 33 q4.5 -3.5 9 0" ${BROW}/>`,
      mouth: '<ellipse cx="50" cy="52" rx="6.2" ry="4.8" fill="#7c3f31"/><ellipse cx="50" cy="54.6" rx="3.8" ry="1.9" fill="#ef6fb0"/>',
    },
    meh: {
      brows: `<path d="M39 34.5 h9" ${BROW}/><path d="M52 34.5 h9" ${BROW}/>`,
      mouth: `<path d="M43.5 51 h13" ${MOUTH_INK}/>`,
    },
    wow: {
      brows: `<path d="M39 32.5 q4.5 -3.5 9 0" ${BROW}/><path d="M52 32.5 q4.5 -3.5 9 0" ${BROW}/>`,
      mouth: '<circle cx="50" cy="52" r="3.8" fill="#7c3f31"/>',
    },
    smirk: {
      brows: `<path d="M39 32.8 q4.5 -3.5 9 0" ${BROW}/><path d="M52 34.8 h9" ${BROW}/>`,
      mouth: `<path d="M42.5 50.5 q7.5 4.5 14.5 -1" ${MOUTH_INK}/>`,
    },
  };

  /* ---------- facial hair (drawn in the hair color, under the mouth) ---------- */
  const FACIAL_HAIR_ART = {
    none: '',
    mustache: '<path d="M50 46.6 C48 44 41.8 43.8 40.4 46.2 C39.2 48.2 40.8 50.2 43.2 50 C45.8 49.8 48.4 48.6 50 46.6 C51.6 48.6 54.2 49.8 56.8 50 C59.2 50.2 60.8 48.2 59.6 46.2 C58.2 43.8 52 44 50 46.6 Z" fill="{hc}"/>',
    beard: '<path d="M33.8 42 C34 52 41 60.5 50 60.5 C59 60.5 66 52 66.2 42 C62 48.5 56.5 51 50 51 C43.5 51 38 48.5 33.8 42 Z" fill="{hc}"/>',
    goatee: '<path d="M42.8 53.5 C43.8 58.5 46.4 61.5 50 61.5 C53.6 61.5 56.2 58.5 57.2 53.5 C55 55.4 52.6 56.2 50 56.2 C47.4 56.2 45 55.4 42.8 53.5 Z" fill="{hc}"/>',
    stubble: '<path d="M33.8 42 C34 52 41 60.5 50 60.5 C59 60.5 66 52 66.2 42 C62 48.5 56.5 51 50 51 C43.5 51 38 48.5 33.8 42 Z" fill="{hc}" opacity=".32"/>',
  };

  /* ---------- outfits (back = cape etc. behind the torso, front = the torso itself) ---------- */
  const TORSO = 'M14 100 C14 76 30 66 50 66 C70 66 86 76 86 100 Z';
  const OUTFIT_ART = {
    tshirt: {
      back: '',
      front: `<path d="${TORSO}" fill="{oc}"/><path d="M41.5 66.8 A9 5.5 0 0 0 58.5 66.8 L55.5 71 A7 4.2 0 0 1 44.5 71 Z" fill="{od}"/><rect x="59" y="81" width="9" height="8" rx="1.6" fill="{od}" opacity=".5"/>`,
    },
    hoodie: {
      back: '',
      front: `<path d="${TORSO}" fill="{oc}"/><path d="M35.5 71 A14.5 10.5 0 0 1 64.5 71 L61 77.5 A11.5 7.5 0 0 0 39 77.5 Z" fill="{od}"/><rect x="37.5" y="84.5" width="25" height="11.5" rx="3.5" fill="{od}" opacity=".45"/><path d="M46 72.5 L44.8 80.5 M54 72.5 L55.2 80.5" stroke="#ffffff" stroke-width="2" stroke-linecap="round"/>`,
    },
    jacket: {
      back: '',
      front: `<path d="${TORSO}" fill="{oc}"/><path d="M42.5 66 L57.5 66 L50 84 Z" fill="#ffffff"/><path d="M42.5 66 L50 84 L40.5 75 Z" fill="{od}"/><path d="M57.5 66 L50 84 L59.5 75 Z" fill="{od}"/><path d="M50 84 L50 100" stroke="{od}" stroke-width="2"/>`,
    },
    sweater: {
      back: '',
      front: `<path d="${TORSO}" fill="{oc}"/><path d="M16.8 79.5 C30 76.2 70 76.2 83.2 79.5 L83.2 84.7 C70 81.7 30 81.7 16.8 84.7 Z" fill="{ol}" opacity=".85"/><path d="M16.8 89.5 C30 86.2 70 86.2 83.2 89.5 L83.2 94.7 C70 91.7 30 91.7 16.8 94.7 Z" fill="{ol}" opacity=".85"/><path d="M41.5 66.8 A9 5.5 0 0 0 58.5 66.8 L56 70.5 A7.5 4.5 0 0 1 44 70.5 Z" fill="{od}"/>`,
    },
    suit: {
      back: '',
      front: `<path d="${TORSO}" fill="{oc}"/><path d="M41 66 L59 66 L50 87 Z" fill="#ffffff"/><path d="M41 66 L50 87 L40 76 Z" fill="{od}"/><path d="M59 66 L50 87 L60 76 Z" fill="{od}"/><rect x="47.8" y="66.3" width="4.4" height="4.4" rx="1" fill="#c2273a"/><path d="M50 70.7 L53.2 74.5 L51.4 84 L48.6 84 L46.8 74.5 Z" fill="#e23b4e"/>`,
    },
    superhero: {
      back: '<path d="M17 67 C6 77 3.5 89 5.5 100 L16 100 C13.5 88 15 77 20 71 Z" fill="#d92638"/><path d="M83 67 C94 77 96.5 89 94.5 100 L84 100 C86.5 88 85 77 80 71 Z" fill="#d92638"/>',
      front: `<path d="${TORSO}" fill="{oc}"/><circle cx="50" cy="83" r="7.4" fill="#ffd166" stroke="{od}" stroke-width="1.6"/><path d="M51.6 77 L46.8 84.2 L50.2 84.2 L48.4 89 L54.2 81.4 L50.7 81.4 Z" fill="{od}"/>`,
    },
    overalls: {
      back: '',
      front: `<path d="${TORSO}" fill="{oc}"/><path d="M14 100 C14 85 19.5 75.5 29 69.5 L29 100 Z" fill="#3a6fd8"/><path d="M86 100 C86 85 80.5 75.5 71 69.5 L71 100 Z" fill="#3a6fd8"/><rect x="39" y="78" width="22" height="22" fill="#3a6fd8"/><rect x="40" y="66" width="6" height="13" fill="#3a6fd8"/><rect x="54" y="66" width="6" height="13" fill="#3a6fd8"/><circle cx="43" cy="79.5" r="1.9" fill="#ffd166"/><circle cx="57" cy="79.5" r="1.9" fill="#ffd166"/>`,
    },
    tank: {
      back: '',
      front: `<path d="${TORSO}" fill="{sk}"/><path d="M25.5 100 C25.5 79 35.5 67.5 50 67.5 C64.5 67.5 74.5 79 74.5 100 Z" fill="{oc}"/><path d="M41.5 68 A9 5.5 0 0 0 58.5 68 L55.5 72.5 A7 4.2 0 0 1 44.5 72.5 Z" fill="{od}"/>`,
    },
  };

  /* ---------- hats (fixed colors, drawn over the hair) ---------- */
  const HAT_ART = {
    none: '',
    cap: '<path d="M30.5 36.5 A19.5 15.5 0 0 1 69.5 36.5 Z" fill="#e23b4e"/><ellipse cx="50" cy="37.5" rx="25" ry="4.6" fill="#c2273a"/><circle cx="50" cy="21.8" r="2.4" fill="#c2273a"/>',
    beanie: '<path d="M30.5 33.5 A19.5 16.5 0 0 1 69.5 33.5 L69.5 37 L30.5 37 Z" fill="#3a6fd8"/><rect x="29.5" y="33.5" width="41" height="6.5" rx="3.2" fill="#2b4f9e"/><circle cx="50" cy="16.5" r="4.6" fill="#ffffff"/>',
    cowboy: '<ellipse cx="50" cy="35.5" rx="26" ry="5" fill="#b07a3f"/><path d="M36.5 35.5 L36.5 27 A13.5 9.5 0 0 1 63.5 27 L63.5 35.5 Z" fill="#c08b4e"/><rect x="36.5" y="30.5" width="27" height="4.4" fill="#7a4a21"/>',
    crown: '<polygon points="34.5,34 34.5,19 42.5,27.5 50,15.5 57.5,27.5 65.5,19 65.5,34" fill="#f5b921" stroke="#d9930d" stroke-width="1.4" stroke-linejoin="round"/><rect x="34.5" y="30.5" width="31" height="3.6" fill="#d9930d"/><circle cx="50" cy="27.5" r="2.5" fill="#e23b4e"/>',
    party: '<polygon points="37.5,33.5 50,7.5 62.5,33.5" fill="#ef6fb0"/><circle cx="46" cy="24" r="2.1" fill="#ffffff"/><circle cx="54.5" cy="28.5" r="2.1" fill="#ffffff"/><circle cx="50" cy="7.5" r="3.6" fill="#ffd166"/><ellipse cx="50" cy="34" rx="14" ry="2.6" fill="#d14f8d"/>',
    tophat: '<rect x="35.5" y="7" width="29" height="25" fill="#2b2b33"/><rect x="35.5" y="25.5" width="29" height="5.5" fill="#e23b4e"/><ellipse cx="50" cy="33" rx="25" ry="4.6" fill="#2b2b33"/>',
    wizard: '<polygon points="33.5,34.5 55.5,5.5 64,34.5" fill="#4b3a8f"/><ellipse cx="50" cy="35.5" rx="24" ry="4.6" fill="#3a2c70"/><polygon points="52,15 53.4,18.6 57.2,18.8 54.2,21.1 55.2,24.8 52,22.7 48.8,24.8 49.8,21.1 46.8,18.8 50.6,18.6" fill="#ffd166"/><circle cx="44" cy="27" r="2" fill="#ffd166"/>',
  };

  /* ---------- glasses (drawn last, over the eyes) ---------- */
  const GLASS_INK = 'fill="rgba(255,255,255,.10)" stroke="#33383f" stroke-width="2"';
  const GLASSES_ART = {
    none: '',
    round: `<circle cx="43.5" cy="41" r="6.2" ${GLASS_INK}/><circle cx="56.5" cy="41" r="6.2" ${GLASS_INK}/><path d="M49.7 40.5 h.6 M37.3 39.8 L32.2 38.8 M62.7 39.8 L67.8 38.8" stroke="#33383f" stroke-width="2" fill="none"/>`,
    square: `<rect x="36.3" y="34.3" width="14.4" height="13" rx="2.4" ${GLASS_INK}/><rect x="49.3" y="34.3" width="14.4" height="13" rx="2.4" ${GLASS_INK}/><path d="M36.3 38.5 L32 37.5 M63.7 38.5 L68 37.5" stroke="#33383f" stroke-width="2" fill="none"/>`,
    shades: '<path d="M35.8 34.8 h15 v6.2 a7.5 6.4 0 0 1 -15 0 Z" fill="#20242b"/><path d="M49.2 34.8 h15 v6.2 a7.5 6.4 0 0 1 -15 0 Z" fill="#20242b"/><path d="M50.8 37.5 h-1.6 M35.8 37 L31.5 35.8 M64.2 37 L68.5 35.8" stroke="#20242b" stroke-width="2.2" fill="none"/><path d="M38.5 37.2 l5 -0.4 M52 37.2 l5 -0.4" stroke="#ffffff" stroke-width="1.3" opacity=".55"/>',
    hearts: '<path d="M43.5 47.2 C38.2 42.8 36.2 39.8 36.2 37.1 A4.3 4.3 0 0 1 43.5 34.6 A4.3 4.3 0 0 1 50.8 37.1 C50.8 39.8 48.8 42.8 43.5 47.2 Z" fill="#ef476f"/><path d="M56.5 47.2 C51.2 42.8 49.2 39.8 49.2 37.1 A4.3 4.3 0 0 1 56.5 34.6 A4.3 4.3 0 0 1 63.8 37.1 C63.8 39.8 61.8 42.8 56.5 47.2 Z" fill="#ef476f"/>',
    stars: '<polygon points="43.5,34.2 45.5,38.9 50.5,39.1 46.7,42.2 47.9,47 43.5,44.1 39.1,47 40.3,42.2 36.5,39.1 41.5,38.9" fill="#f5b921" stroke="#d9930d" stroke-width="1.1" stroke-linejoin="round"/><polygon points="56.5,34.2 58.5,38.9 63.5,39.1 59.7,42.2 60.9,47 56.5,44.1 52.1,47 53.3,42.2 49.5,39.1 54.5,38.9" fill="#f5b921" stroke="#d9930d" stroke-width="1.1" stroke-linejoin="round"/>',
    sport: '<path d="M34.5 35.5 h31 v6.8 a31 7 0 0 1 -31 0 Z" fill="#118ab2" opacity=".92"/><path d="M38 38.2 h17" stroke="#ffffff" stroke-width="1.6" opacity=".6" stroke-linecap="round"/>',
  };

  /* ---------- the whitelist itself ---------- */
  const AVATAR_KEYS = ['skin', 'hair', 'hairColor', 'mouth', 'facialHair', 'outfit', 'outfitColor', 'hat', 'glasses', 'bg'];
  const AVATAR_OPTIONS = {
    skin: Object.keys(SKIN_TONES),
    hair: Object.keys(HAIR_ART),
    hairColor: Object.keys(HAIR_COLORS),
    mouth: Object.keys(MOUTH_ART),
    facialHair: Object.keys(FACIAL_HAIR_ART),
    outfit: Object.keys(OUTFIT_ART),
    outfitColor: Object.keys(OUTFIT_COLORS),
    hat: Object.keys(HAT_ART),
    glasses: Object.keys(GLASSES_ART),
    bg: Object.keys(BACKGROUNDS),
  };
  const AVATAR_DEFAULTS = {
    skin: 'skin2', hair: 'short', hairColor: 'brown', mouth: 'smile',
    facialHair: 'none', outfit: 'tshirt', outfitColor: 'blue',
    hat: 'none', glasses: 'none', bg: 'sky',
  };
  /* Creator categories, in display order, with 1-2 word option labels. */
  const AVATAR_CATEGORIES = [
    { key: 'skin', label: 'Skin', options: [
      { key: 'skin1', label: 'Pale' }, { key: 'skin2', label: 'Light' }, { key: 'skin3', label: 'Tan' },
      { key: 'skin4', label: 'Honey' }, { key: 'skin5', label: 'Bronze' }, { key: 'skin6', label: 'Deep' }] },
    { key: 'hair', label: 'Hair', options: [
      { key: 'none', label: 'Bald' }, { key: 'buzz', label: 'Buzz' }, { key: 'short', label: 'Short' },
      { key: 'spiky', label: 'Spiky' }, { key: 'mohawk', label: 'Mohawk' }, { key: 'curly', label: 'Curly' },
      { key: 'wavy', label: 'Wavy' }, { key: 'long', label: 'Long' }, { key: 'ponytail', label: 'Ponytail' },
      { key: 'bun', label: 'Bun' }] },
    { key: 'hairColor', label: 'Hair color', options: [
      { key: 'black', label: 'Black' }, { key: 'brown', label: 'Brown' }, { key: 'blonde', label: 'Blonde' },
      { key: 'ginger', label: 'Ginger' }, { key: 'red', label: 'Red' }, { key: 'pink', label: 'Pink' },
      { key: 'blue', label: 'Blue' }, { key: 'green', label: 'Green' }, { key: 'purple', label: 'Purple' },
      { key: 'gray', label: 'Gray' }, { key: 'white', label: 'White' }] },
    { key: 'mouth', label: 'Face', options: [
      { key: 'smile', label: 'Smile' }, { key: 'grin', label: 'Grin' }, { key: 'laugh', label: 'Laugh' },
      { key: 'meh', label: 'Meh' }, { key: 'wow', label: 'Wow' }, { key: 'smirk', label: 'Smirk' }] },
    { key: 'facialHair', label: 'Beard', options: [
      { key: 'none', label: 'None' }, { key: 'mustache', label: 'Mustache' }, { key: 'beard', label: 'Beard' },
      { key: 'goatee', label: 'Goatee' }, { key: 'stubble', label: 'Stubble' }] },
    { key: 'outfit', label: 'Clothes', options: [
      { key: 'tshirt', label: 'T-Shirt' }, { key: 'hoodie', label: 'Hoodie' }, { key: 'jacket', label: 'Jacket' },
      { key: 'sweater', label: 'Sweater' }, { key: 'suit', label: 'Suit' }, { key: 'superhero', label: 'Hero' },
      { key: 'overalls', label: 'Overalls' }, { key: 'tank', label: 'Tank top' }] },
    { key: 'outfitColor', label: 'Color', options: [
      { key: 'red', label: 'Red' }, { key: 'blue', label: 'Blue' }, { key: 'green', label: 'Green' },
      { key: 'purple', label: 'Purple' }, { key: 'orange', label: 'Orange' }, { key: 'pink', label: 'Pink' },
      { key: 'yellow', label: 'Yellow' }, { key: 'teal', label: 'Teal' }, { key: 'black', label: 'Black' },
      { key: 'white', label: 'White' }] },
    { key: 'hat', label: 'Hat', options: [
      { key: 'none', label: 'None' }, { key: 'cap', label: 'Cap' }, { key: 'beanie', label: 'Beanie' },
      { key: 'cowboy', label: 'Cowboy' }, { key: 'crown', label: 'Crown' }, { key: 'party', label: 'Party' },
      { key: 'tophat', label: 'Top hat' }, { key: 'wizard', label: 'Wizard' }] },
    { key: 'glasses', label: 'Glasses', options: [
      { key: 'none', label: 'None' }, { key: 'round', label: 'Round' }, { key: 'square', label: 'Square' },
      { key: 'shades', label: 'Shades' }, { key: 'hearts', label: 'Hearts' }, { key: 'stars', label: 'Stars' },
      { key: 'sport', label: 'Sport' }] },
    { key: 'bg', label: 'Backdrop', options: [
      { key: 'plain', label: 'Plain' }, { key: 'sky', label: 'Sky' }, { key: 'sunset', label: 'Sunset' },
      { key: 'beach', label: 'Beach' }, { key: 'forest', label: 'Forest' }, { key: 'rainbow', label: 'Rainbow' },
      { key: 'night', label: 'Night' }, { key: 'space', label: 'Space' }, { key: 'mint', label: 'Mint' },
      { key: 'pink', label: 'Pink' }, { key: 'purple', label: 'Purple' }] },
  ];

  /* The stored config is a short JSON string; anything longer than
   * this is garbage, not an avatar. */
  const AVATAR_MAX_LEN = 400;

  /* Validate + normalize an avatar payload. Accepts a config object
   * or its JSON string. Returns a COMPLETE config (missing keys fall
   * back to the defaults) or null when anything is off: not an object,
   * an unknown key, a value that isn't a string on the whitelist, or
   * an oversized payload. Used by the server before storing, and by
   * the server again when reading a stored value back out (defense in
   * depth — a hand-edited DB row still can't inject markup). */
  function sanitizeAvatar(input) {
    let obj = input;
    if (typeof obj === 'string') {
      if (obj.length > 1000) return null;
      try { obj = JSON.parse(obj); } catch (e) { return null; }
    }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
    const picked = {};
    for (const k of Object.keys(obj)) {
      if (!AVATAR_KEYS.includes(k)) return null;
      const v = obj[k];
      if (typeof v !== 'string' || !AVATAR_OPTIONS[k].includes(v)) return null;
      picked[k] = v;
    }
    const full = { ...AVATAR_DEFAULTS, ...picked };
    if (JSON.stringify(full).length > AVATAR_MAX_LEN) return null;
    return full;
  }

  return {
    SKIN_TONES, HAIR_COLORS, OUTFIT_COLORS, BACKGROUNDS,
    HAIR_ART, MOUTH_ART, FACIAL_HAIR_ART, OUTFIT_ART, HAT_ART, GLASSES_ART,
    AVATAR_KEYS, AVATAR_OPTIONS, AVATAR_DEFAULTS, AVATAR_CATEGORIES,
    AVATAR_MAX_LEN, sanitizeAvatar,
  };
});
