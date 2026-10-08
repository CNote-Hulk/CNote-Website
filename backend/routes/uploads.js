/* ─────────────────────────────────────────
   FILE: uploads.js
   DESCRIPTION: Chat attachment uploads (images + voice messages + stickers) —
   /api/uploads. Client asks here for a presigned PUT URL, uploads the
   file bytes directly to object storage, then sends the returned
   attachment_key along with the chat/DM message. The file itself never
   passes through this server.
   ───────────────────────────────────────── */
/* ── REQUIRED IMPORTS — DO NOT REMOVE ──────
   If you add a new package:
     1. require() it here
     2. Add it to package.json dependencies
   ────────────────────────────────────────── */
const express = require('express');
const { authRequired } = require('../middleware/auth');
const { buildAttachmentKey, getPresignedUploadUrl, publicUrlForKey } = require('../utils/objectStorage');

const router = express.Router();

const IMAGE_TYPES = {
	'image/jpeg': 'jpg',
	'image/png': 'png',
	'image/webp': 'webp',
	'image/gif': 'gif',
};
const VOICE_TYPES = {
	'audio/webm': 'webm',
	'audio/ogg': 'ogg',
	'audio/mp4': 'm4a',
	'audio/mpeg': 'mp3',
	'audio/wav': 'wav',
};

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;   // 8 MB
const MAX_VOICE_BYTES = 15 * 1024 * 1024;  // 15 MB (few minutes of voice)

const VALID_KINDS = ['image', 'voice', 'sticker', 'gallery', 'tutorial', 'listing', 'forum', 'article', 'console', 'myspace'];

// POST /api/uploads/presign — { kind: 'image'|'voice'|'gallery'|'tutorial'|'listing'|'forum'|'article'|'console', contentType, fileSize }
router.post('/presign', authRequired, async (req, res) => {
	try {
		const { kind, contentType, fileSize } = req.body || {};

		if (!VALID_KINDS.includes(kind)) {
			return res.status(400).json({ success: false, error: `Invalid kind — must be one of: ${VALID_KINDS.join(', ')}.` });
		}
		if ((kind === 'tutorial' || kind === 'article' || kind === 'console') && (!req.user || req.user.role !== 'admin')) {
			return res.status(403).json({ success: false, error: 'Acces interzis.' });
		}

		const typeMap = kind === 'voice' ? VOICE_TYPES : IMAGE_TYPES; // everything else reuses the image type/size limits
		const extension = typeMap[contentType];
		if (!extension) {
			return res.status(400).json({ success: false, error: `Unsupported content type for ${kind}.` });
		}

		const size = parseInt(fileSize);
		const maxBytes = kind === 'voice' ? MAX_VOICE_BYTES : MAX_IMAGE_BYTES;
		if (!Number.isFinite(size) || size <= 0 || size > maxBytes) {
			return res.status(400).json({ success: false, error: `File too large — max ${Math.round(maxBytes / 1024 / 1024)}MB.` });
		}

		const key = kind === 'gallery' ? buildAttachmentKey(req.user.id, 'gallery', extension, 'community')
			: kind === 'tutorial' ? buildAttachmentKey(req.user.id, 'tutorial', extension, 'console-tutorials')
			: kind === 'listing'  ? buildAttachmentKey(req.user.id, 'listing', extension, 'marketplace')
			: kind === 'forum'    ? buildAttachmentKey(req.user.id, 'image', extension, 'forum')
			: kind === 'article'  ? buildAttachmentKey(req.user.id, 'image', extension, 'articles')
			: kind === 'console'  ? buildAttachmentKey(req.user.id, 'image', extension, 'consoles')
			: kind === 'myspace'  ? buildAttachmentKey(req.user.id, 'photo', extension, 'my-space')
			: kind === 'sticker'  ? buildAttachmentKey(req.user.id, 'stickers', extension)
			: buildAttachmentKey(req.user.id, kind === 'image' ? 'images' : 'voice', extension);
		const uploadUrl = await getPresignedUploadUrl(key, contentType);

		res.json({
			success: true,
			uploadUrl,
			key,
			publicUrl: publicUrlForKey(key),
		});
	} catch (err) {
		console.error('Upload presign POST error:', err.message);
		res.status(500).json({ success: false, error: 'Storage not available — try again shortly.' });
	}
});

module.exports = router;
