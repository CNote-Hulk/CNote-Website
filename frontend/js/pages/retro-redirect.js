/**
 * play.html and duel.html used to be pages of their own; since 2026-11-27 game nights live in
 * Community → Retro Gaming (js/modules/retro-hub.js). The emulator and the QR codes it shows still
 * open the old addresses, so these two pages only send the visitor to the right place.
 */
const q = new URLSearchParams(location.search);
let to = 'mine';
if (q.get('s')) to = 'session/' + encodeURIComponent(q.get('s'));
else if (q.get('link')) to = 'link/' + encodeURIComponent(q.get('link'));
else if (q.get('m') && q.get('k')) to = 'duel/' + encodeURIComponent(q.get('m') + '.' + q.get('k'));
location.replace('/html/pages/community.html#retro/' + to);
