'use strict';
/* Sveiki Chat — avatar pictures: THE one shared whitelist for the
 * preset avatar pictures. This single module is loaded by the
 * browser (as the globals `AvatarPics` + `AvatarLib`, via a plain
 * <script> tag before app.js) AND required by the server
 * (server/index.js) to validate PATCH /api/me avatar payloads.
 *
 * A saved avatar is simply one of the whitelisted ids below, and
 * the picture itself is a static file under /avatars/. If an id
 * isn't in this module, it doesn't exist: the server only ever
 * stores ids from here, and the client only ever renders <img>
 * tags for ids from here, so a stored avatar can never smuggle
 * markup into anyone's page.
 *
 * TWO families:
 *   * Faces — 24 glossy 3D animated-movie style portraits
 *     ("p01".."p24", balanced 12 men + 12 women). One square
 *     picture per id, used at every size.
 *   * Dress-up — 2 fixed characters (d1 "Man", d2 "Woman") x 50
 *     named full-body looks ("d1-o01".."d2-o50"). Every look has
 *     TWO files: the full-body portrait (<id>.webp, shown on the
 *     Profile page and in the studio) and a face crop
 *     (<id>-face.webp, a head-and-shoulders crop shown in the
 *     small round slots — feed, comments, lists, chat, map pins —
 *     where a whole body would shrink to a speck). avatarUrls()
 *     resolves an id to { small, full } so callers never build
 *     these paths by hand.
 *
 * Old rows written by the retired build-a-character maker hold a
 * JSON config object; they are NOT valid ids, so they read back
 * as "no avatar" and the client falls back to the classic
 * initial-letter circle. */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.AvatarPics = api.AVATAR_PICS; root.AvatarLib = api; }
})(typeof self !== 'undefined' ? self : this, function () {

  const AVATAR_PICS = [
    'p01', 'p02', 'p03', 'p04', 'p05', 'p06', 'p07', 'p08',
    'p09', 'p10', 'p11', 'p12', 'p13', 'p14', 'p15', 'p16',
    'p17', 'p18', 'p19', 'p20', 'p21', 'p22', 'p23', 'p24',
  ];

  /* The dress-up studio: two fixed characters, each with the same
   * 50 named looks (look n is DRESSUP_LOOKS[n-1] for both). */
  const DRESSUP_CHARACTERS = [
    { id: 'd1', name: 'Man' },
    { id: 'd2', name: 'Woman' },
  ];
  const DRESSUP_LOOKS = [
    'Casual Hoodie', 'Tee & Jeans', 'Flannel', 'Denim', 'Sweater',
    'Polo', 'Shorts Set', 'Tracksuit', 'Navy Suit', 'Black Suit',
    'Tuxedo/Evening Gown', 'Burgundy', 'Red Carpet', 'Emerald', 'Gold Party',
    'Cocktail', 'Football', 'Basketball', 'Baseball', 'Gym',
    'Runner', 'Soccer', 'Skate', 'Boxing', 'Red Street',
    'Leather', 'Bomber', 'Camo', 'Puffer Street', 'Graffiti Hoodie',
    'Beach', 'Summer', 'Winter Coat', 'Winter Puffer', 'Rainy Day',
    'Fall Layers', 'Holiday', 'Pumpkin', 'Cowboy/Cowgirl', 'Biker',
    'Pajamas', 'Retro 80s', 'Disco', 'Chef', 'Wedding',
    'Business Casual', 'Pink Pop', 'Royal Blue', 'All Black', 'All White',
  ];
  const DRESSUP_PICS = [];
  for (const ch of DRESSUP_CHARACTERS) {
    for (let i = 1; i <= DRESSUP_LOOKS.length; i++) {
      DRESSUP_PICS.push(ch.id + '-o' + String(i).padStart(2, '0'));
    }
  }

  const DRESSUP_RE = /^d([12])-o(0[1-9]|[1-4][0-9]|50)$/;

  /* True only for a string that is exactly one of the dress-up
   * ids ("d1-o01".."d2-o50") — strict shape AND catalog membership,
   * so d1-o51, d3-o01, d1-o00 and d1-o1 are all refused. */
  function isDressupPic(v) {
    return typeof v === 'string' && DRESSUP_RE.test(v) && DRESSUP_PICS.includes(v);
  }

  /* True only for a string that is exactly one of the storable
   * avatar ids — a face portrait OR a dress-up look. */
  function isAvatarPic(v) {
    return typeof v === 'string' && (AVATAR_PICS.includes(v) || isDressupPic(v));
  }

  /* The stored-avatar reader: a valid id passes through; anything
   * else — null, a retired maker's JSON config, garbage — becomes
   * null, i.e. "no avatar" (the initial-letter circle). */
  function sanitizeAvatarId(raw) {
    return isAvatarPic(raw) ? raw : null;
  }

  /* Resolve an avatar id to its picture URLs:
   *   { small: the face-sized file for small round slots,
   *     full:  the full picture for the Profile page / studio }
   * Face portraits use the same file at both sizes; a dress-up
   * look's small is its -face crop and its full is the full-body
   * portrait. Anything that isn't a whitelisted id resolves to
   * null, so callers can never be tricked into rendering an
   * arbitrary path. */
  function avatarUrls(id) {
    if (typeof id !== 'string') return null;
    if (AVATAR_PICS.includes(id)) {
      const url = '/avatars/' + id + '.webp';
      return { small: url, full: url };
    }
    if (isDressupPic(id)) {
      return { small: '/avatars/' + id + '-face.webp', full: '/avatars/' + id + '.webp' };
    }
    return null;
  }

  return {
    AVATAR_PICS, DRESSUP_CHARACTERS, DRESSUP_LOOKS, DRESSUP_PICS,
    isAvatarPic, isDressupPic, sanitizeAvatarId, avatarUrls,
  };
});
