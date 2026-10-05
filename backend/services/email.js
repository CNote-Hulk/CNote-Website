/* ─────────────────────────────────────────
   FILE: email.js
   DESCRIPTION: Email service using Resend API. Handles
   verification, password reset, 2FA codes, and contact
   form emails with branded HTML templates.
   ───────────────────────────────────────── */
const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

const FROM = 'Console Notebook <noreply@consolenotebook.com>';
const BASE_URL = () => process.env.BASE_URL || 'http://localhost:3000';
const CONTACT_TO = () => process.env.CONTACT_RECEIVER_EMAIL || 'console.notebook.app@gmail.com';

/**
 * escapeHtml
 * @description Prevents XSS by escaping HTML special characters.
 */
function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/**
 * wrapTemplate
 * @description Wraps email content in the branded CNote HTML template.
 */
function wrapTemplate(title, content) {
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#0a0a14;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:linear-gradient(135deg,#1a1a2e,#16213e);border-bottom:1px solid rgba(232,213,183,0.1);">
    <tr>
      <td style="padding:32px 48px;">
        <p style="margin:0;font-size:11px;letter-spacing:3px;color:#a89880;text-transform:uppercase;">Console Notebook</p>
        <h1 style="margin:8px 0 0;font-size:26px;color:#e8d5b7;font-weight:600;">${title}</h1>
      </td>
    </tr>
  </table>
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a14;">
    <tr>
      <td style="padding:48px 48px 40px;">
        ${content}
      </td>
    </tr>
  </table>
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0d0d1a;border-top:1px solid rgba(232,213,183,0.07);">
    <tr>
      <td style="padding:24px 48px;">
        <p style="margin:0;font-size:12px;color:#4a4060;line-height:1.6;">
          If you did not request this email, you can safely ignore it.<br>
          &copy; 2026 Console Notebook &middot; <a href="https://consolenotebook.com" style="color:#6a5a7a;text-decoration:none;">consolenotebook.com</a>
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * sendVerificationEmail
 * @description Email: sent to user after registration to verify their address.
 */
async function sendVerificationEmail(to, token, baseUrl) {
    const verifyLink = String(baseUrl || BASE_URL()).replace(/\/$/, '') + '/html/pages/verify-success.html?token=' + encodeURIComponent(token);
    const html = wrapTemplate('Verify Email Address', `
              <p style="color:#c8b99a;font-size:15px;line-height:1.7;margin:0 0 24px;">
                Welcome to Console Notebook! To activate your account,
                verify your email address by clicking the button below.
              </p>
              <a href="${verifyLink}" style="display:inline-block;background:#e8d5b7;color:#0a0a14;font-weight:700;font-size:14px;padding:14px 32px;border-radius:8px;text-decoration:none;letter-spacing:0.5px;">
                Verify Email
              </a>
              <p style="color:#5a5070;font-size:12px;margin:20px 0 0;">
                This link expires in 24 hours.
              </p>`);

    try {
        const { data, error } = await resend.emails.send({
            from: FROM,
            to,
            subject: 'Verify your email address — CNote',
            html
        });
        if (error) {
            console.error('Resend error (verification):', error);
            return { success: false, error: error.message };
        }
        console.log('Verification email sent to:', to, '| Id:', data?.id);
        return { success: true };
    } catch (err) {
        console.error('Resend exception (verification):', err);
        return { success: false, error: err.message };
    }
}

/**
 * sendPasswordResetEmail
 * @description Email: sent to user when they request a password reset.
 */
async function sendPasswordResetEmail(to, token, baseUrl) {
    const resetLink = String(baseUrl || BASE_URL()).replace(/\/$/, '') + '/html/pages/reset-password.html?token=' + encodeURIComponent(token);
    const html = wrapTemplate('Password Reset', `
              <p style="color:#c8b99a;font-size:15px;line-height:1.7;margin:0 0 24px;">
                We received a password reset request for your CNote account.
                If you made this request, click the button below.
              </p>
              <a href="${resetLink}" style="display:inline-block;background:#e8d5b7;color:#0a0a14;font-weight:700;font-size:14px;padding:14px 32px;border-radius:8px;text-decoration:none;letter-spacing:0.5px;">
                Reset Password
              </a>
              <p style="color:#5a5070;font-size:12px;margin:20px 0 0;">
                This link expires in 24 hours.
              </p>`);

    try {
        const { data, error } = await resend.emails.send({
            from: FROM,
            to,
            subject: 'Password reset — CNote',
            html
        });
        if (error) {
            console.error('Resend error (password reset):', error);
            return { success: false, error: error.message };
        }
        console.log('Password reset email sent to:', to, '| Id:', data?.id);
        return { success: true };
    } catch (err) {
        console.error('Resend exception (password reset):', err);
        return { success: false, error: err.message };
    }
}

/**
 * sendTwoFactorEmail
 * @description Email: sent to user as 2FA verification code (10 min expiry).
 */
async function sendTwoFactorEmail(to, code) {
    const safeCode = escapeHtml(String(code));
    const html = wrapTemplate('Verification Code', `
              <p style="color:#c8b99a;font-size:15px;line-height:1.7;margin:0 0 24px;">
                Your two-step verification code is:
              </p>
              <div style="background:#0a0a14;border:1px solid rgba(232,213,183,0.15);border-radius:12px;padding:24px;text-align:center;margin:0 0 24px;">
                <span style="font-size:36px;font-weight:700;letter-spacing:10px;color:#e8d5b7;font-family:monospace;">
                  ${safeCode}
                </span>
              </div>
              <p style="color:#5a5070;font-size:12px;margin:0;">
                The code is valid for 10 minutes. Do not share it with anyone.
              </p>`);

    try {
        const { data, error } = await resend.emails.send({
            from: FROM,
            to,
            subject: 'Your verification code — CNote',
            html
        });
        if (error) {
            console.error('Resend error (2FA):', error);
            return { success: false, error: error.message };
        }
        console.log('2FA email sent to:', to, '| Id:', data?.id);
        return { success: true };
    } catch (err) {
        console.error('Resend exception (2FA):', err);
        return { success: false, error: err.message };
    }
}

/**
 * sendContactEmail
 * @description Email: sends contact form to admin + auto-confirmation to sender.
 *              Two emails: 1) full message to admin, 2) thank-you to user.
 */
async function sendContactEmail(from, name, subject, message) {
    const safeName = escapeHtml(name);
    const safeFrom = escapeHtml(from);
    const safeSubject = escapeHtml(subject);
    const safeMessage = escapeHtml(message);

    const adminHtml = wrapTemplate('New Message — Contact', `
              <p style="color:#c8b99a;font-size:14px;margin:0 0 20px;">
                You received a new message through the contact form.
              </p>
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr><td style="padding:8px 0;border-bottom:1px solid rgba(232,213,183,0.07);">
                  <span style="color:#5a5070;font-size:12px;text-transform:uppercase;letter-spacing:1px;">From</span><br>
                  <span style="color:#e8d5b7;font-size:14px;">${safeName} &middot; ${safeFrom}</span>
                </td></tr>
                <tr><td style="padding:8px 0;border-bottom:1px solid rgba(232,213,183,0.07);">
                  <span style="color:#5a5070;font-size:12px;text-transform:uppercase;letter-spacing:1px;">Subject</span><br>
                  <span style="color:#e8d5b7;font-size:14px;">${safeSubject}</span>
                </td></tr>
                <tr><td style="padding:16px 0 0;">
                  <span style="color:#5a5070;font-size:12px;text-transform:uppercase;letter-spacing:1px;">Message</span><br>
                  <p style="color:#c8b99a;font-size:14px;line-height:1.7;margin:8px 0 0;">${safeMessage}</p>
                </td></tr>
              </table>`);

    const siteLink = String(BASE_URL()).replace(/\/$/, '') + '/html/pages/index.html#contact';
    const confirmationHtml = wrapTemplate('Thank you for your message', `
              <p style="color:#c8b99a;font-size:15px;line-height:1.7;margin:0 0 24px;">
                Thank you for contacting us. We will reply as soon as possible.
              </p>
              <a href="${siteLink}" style="display:inline-block;background:#e8d5b7;color:#0a0a14;font-weight:700;font-size:14px;padding:14px 32px;border-radius:8px;text-decoration:none;letter-spacing:0.5px;">
                Back to site
              </a>`);

    try {
        const { error: adminErr } = await resend.emails.send({
            from: FROM,
            to: CONTACT_TO(),
            subject: `CNote Contact: ${subject}`,
            html: adminHtml
        });
        if (adminErr) {
            console.error('Resend error (contact admin):', adminErr);
            return { success: false, error: adminErr.message };
        }

        const { error: confirmErr } = await resend.emails.send({
            from: FROM,
            to: from,
            subject: 'We received your message — CNote',
            html: confirmationHtml
        });
        if (confirmErr) {
            console.error('Resend error (contact confirmation):', confirmErr);
        }

        console.log('Contact emails sent for:', from);
        return { success: true };
    } catch (err) {
        console.error('Resend exception (contact):', err);
        return { success: false, error: err.message };
    }
}

/**
 * sendRepairRequestNotification
 * @description Email: notifies admin when a user submits a new repair request.
 */
async function sendRepairRequestNotification({ username, console: consoleName, symptoms, customSymptom, description, requestId }) {
    const safeUser = escapeHtml(username);
    const safeConsole = escapeHtml(consoleName);
    const safeSymptoms = symptoms.map(s => escapeHtml(s)).join(', ');
    const safeCustom = escapeHtml(customSymptom);
    const safeDesc = escapeHtml(description);

    const html = wrapTemplate('New Repair Request', `
              <p style="color:#c8b99a;font-size:14px;margin:0 0 20px;">
                A new repair request has been submitted.
              </p>
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr><td style="padding:8px 0;border-bottom:1px solid rgba(232,213,183,0.07);">
                  <span style="color:#5a5070;font-size:12px;text-transform:uppercase;letter-spacing:1px;">User</span><br>
                  <span style="color:#e8d5b7;font-size:14px;">${safeUser}</span>
                </td></tr>
                <tr><td style="padding:8px 0;border-bottom:1px solid rgba(232,213,183,0.07);">
                  <span style="color:#5a5070;font-size:12px;text-transform:uppercase;letter-spacing:1px;">Console</span><br>
                  <span style="color:#e8d5b7;font-size:14px;">${safeConsole}</span>
                </td></tr>
                <tr><td style="padding:8px 0;border-bottom:1px solid rgba(232,213,183,0.07);">
                  <span style="color:#5a5070;font-size:12px;text-transform:uppercase;letter-spacing:1px;">Symptoms</span><br>
                  <span style="color:#e8d5b7;font-size:14px;">${safeSymptoms}</span>
                  ${safeCustom ? `<br><span style="color:#c8b99a;font-size:13px;font-style:italic;">Custom: ${safeCustom}</span>` : ''}
                </td></tr>
                ${safeDesc ? `<tr><td style="padding:16px 0 0;">
                  <span style="color:#5a5070;font-size:12px;text-transform:uppercase;letter-spacing:1px;">Description</span><br>
                  <p style="color:#c8b99a;font-size:14px;line-height:1.7;margin:8px 0 0;">${safeDesc}</p>
                </td></tr>` : ''}
              </table>
              <p style="color:#5a5070;font-size:12px;margin:20px 0 0;">
                Request #${Number(requestId)} &middot; Review in the admin panel.
              </p>`);

    try {
        const { data, error } = await resend.emails.send({
            from: FROM,
            to: CONTACT_TO(),
            subject: `New Repair Request #${Number(requestId)} — ${safeUser} — CNote`,
            html
        });
        if (error) {
            console.error('Resend error (repair admin):', error);
            return { success: false, error: error.message };
        }
        console.log('Repair admin email sent | Id:', data?.id);
        return { success: true };
    } catch (err) {
        console.error('Resend exception (repair admin):', err);
        return { success: false, error: err.message };
    }
}

/**
 * sendRepairReplyNotification
 * @description Email: notifies user when admin updates their repair request status or adds a reply.
 */
async function sendRepairReplyNotification({ to, username, console: consoleName, status, adminReply, requestId }) {
    const safeUser = escapeHtml(username);
    const safeConsole = escapeHtml(consoleName);
    const safeReply = escapeHtml(adminReply);

    const statusLabels = {
        pending: '🟡 Pending',
        in_progress: '🔵 In Progress',
        resolved: '🟢 Resolved'
    };
    const statusLabel = statusLabels[status] || escapeHtml(status);

    const html = wrapTemplate('Repair Request Update', `
              <p style="color:#c8b99a;font-size:15px;line-height:1.7;margin:0 0 24px;">
                Hi ${safeUser}, your repair request for <strong style="color:#e8d5b7;">${safeConsole}</strong> has been updated.
              </p>
              <div style="background:#0a0a14;border:1px solid rgba(232,213,183,0.15);border-radius:12px;padding:20px;margin:0 0 24px;">
                <div style="margin-bottom:12px;">
                  <span style="color:#5a5070;font-size:12px;text-transform:uppercase;letter-spacing:1px;">Status</span><br>
                  <span style="color:#e8d5b7;font-size:16px;font-weight:600;">${statusLabel}</span>
                </div>
                ${safeReply ? `<div>
                  <span style="color:#5a5070;font-size:12px;text-transform:uppercase;letter-spacing:1px;">Admin Reply</span><br>
                  <p style="color:#c8b99a;font-size:14px;line-height:1.7;margin:8px 0 0;">${safeReply}</p>
                </div>` : ''}
              </div>
              <p style="color:#5a5070;font-size:12px;margin:0;">
                Request #${Number(requestId)}
              </p>`);

    try {
        const { data, error } = await resend.emails.send({
            from: FROM,
            to,
            subject: `Repair Request #${Number(requestId)} Updated — CNote`,
            html
        });
        if (error) {
            console.error('Resend error (repair user):', error);
            return { success: false, error: error.message };
        }
        console.log('Repair user email sent to:', to, '| Id:', data?.id);
        return { success: true };
    } catch (err) {
        console.error('Resend exception (repair user):', err);
        return { success: false, error: err.message };
    }
}

/**
 * sendFriendRequestNotification
 * @description Email: notifies a user that they received a friend request.
 */
async function sendFriendRequestNotification({ to, receiverUsername, senderUsername, baseUrl }) {
  const safeReceiver = escapeHtml(receiverUsername || 'there');
  const safeSender = escapeHtml(senderUsername || 'A Console Notebook user');
  const friendsLink = String(baseUrl || BASE_URL()).replace(/\/$/, '') + '/html/pages/profil.html?view=friends';

  const html = wrapTemplate('New Friend Request', `
        <p style="color:#c8b99a;font-size:15px;line-height:1.7;margin:0 0 24px;">
        Hi ${safeReceiver}, <strong style="color:#e8d5b7;">${safeSender}</strong> sent you a friend request on Console Notebook.
        </p>
        <a href="${friendsLink}" style="display:inline-block;background:#e8d5b7;color:#0a0a14;font-weight:700;font-size:14px;padding:14px 32px;border-radius:8px;text-decoration:none;letter-spacing:0.5px;">
        View Friend Requests
        </a>
        <p style="color:#5a5070;font-size:12px;margin:20px 0 0;">
        Open your profile to accept or reject the request.
        </p>`);

  try {
    const { data, error } = await resend.emails.send({
      from: FROM,
      to,
      subject: `${senderUsername || 'Someone'} sent you a friend request — CNote`,
      html
    });
    if (error) {
      console.error('Resend error (friend request):', error);
      return { success: false, error: error.message };
    }
    console.log('Friend request email sent to:', to, '| Id:', data?.id);
    return { success: true };
  } catch (err) {
    console.error('Resend exception (friend request):', err);
    return { success: false, error: err.message };
  }
}

/**
 * sendFriendAcceptedNotification
 * @description Email: notifies the original sender when their friend request was accepted.
 */
async function sendFriendAcceptedNotification({ to, username, accepterUsername, baseUrl }) {
  const safeUser = escapeHtml(username || 'there');
  const safeAccepter = escapeHtml(accepterUsername || 'A Console Notebook user');
  const friendsLink = String(baseUrl || BASE_URL()).replace(/\/$/, '') + '/html/pages/profil.html?view=friends';

  const html = wrapTemplate('Friend Request Accepted', `
        <p style="color:#c8b99a;font-size:15px;line-height:1.7;margin:0 0 24px;">
        Hi ${safeUser}, <strong style="color:#e8d5b7;">${safeAccepter}</strong> accepted your friend request on Console Notebook.
        </p>
        <a href="${friendsLink}" style="display:inline-block;background:#e8d5b7;color:#0a0a14;font-weight:700;font-size:14px;padding:14px 32px;border-radius:8px;text-decoration:none;letter-spacing:0.5px;">
        Open Friends
        </a>
        <p style="color:#5a5070;font-size:12px;margin:20px 0 0;">
        You can now chat and connect in the community.
        </p>`);

  try {
    const { data, error } = await resend.emails.send({
      from: FROM,
      to,
      subject: `${accepterUsername || 'Someone'} accepted your friend request — CNote`,
      html
    });
    if (error) {
      console.error('Resend error (friend accepted):', error);
      return { success: false, error: error.message };
    }
    console.log('Friend accepted email sent to:', to, '| Id:', data?.id);
    return { success: true };
  } catch (err) {
    console.error('Resend exception (friend accepted):', err);
    return { success: false, error: err.message };
  }
}

/**
 * sendSetPasswordEmail
 * @description Email: sent to Google-only users when they request a link to set a password.
 *              Uses the same reset-password page but with a "set" context.
 */
async function sendSetPasswordEmail(to, token, baseUrl) {
    const setLink = String(baseUrl || BASE_URL()).replace(/\/$/, '') + '/html/pages/reset-password.html?token=' + encodeURIComponent(token) + '&mode=set';
    const html = wrapTemplate('Set Your Password', `
              <p style="color:#c8b99a;font-size:15px;line-height:1.7;margin:0 0 24px;">
                You requested to set a password for your Console Notebook account.
                Click the button below to choose your password.
              </p>
              <a href="${setLink}" style="display:inline-block;background:#e8d5b7;color:#0a0a14;font-weight:700;font-size:14px;padding:14px 32px;border-radius:8px;text-decoration:none;letter-spacing:0.5px;">
                Set Password
              </a>
              <p style="color:#5a5070;font-size:12px;margin:20px 0 0;">
                This link expires in 24 hours. If you did not request this, you can safely ignore it — your account is not affected.
              </p>`);

    try {
        const { data, error } = await resend.emails.send({
            from: FROM,
            to,
            subject: 'Set your password — Console Notebook',
            html
        });
        if (error) {
            console.error('Resend error (set-password):', error);
            return { success: false, error: error.message };
        }
        console.log('Set-password email sent to:', to, '| Id:', data?.id);
        return { success: true };
    } catch (err) {
        console.error('Resend exception (set-password):', err);
        return { success: false, error: err.message };
    }
}

/**
 * sendEmailChangedNotification
 * @description Email: notifies the OLD email address that the account email was changed.
 *              Includes a reset link so the user can recover access if the change was unauthorised.
 */
async function sendEmailChangedNotification(oldEmail, newEmail, resetToken, baseUrl) {
    const safeNew = escapeHtml(newEmail);
    const resetLink = String(baseUrl || BASE_URL()).replace(/\/$/, '') + '/html/pages/reset-password.html?token=' + encodeURIComponent(resetToken);
    const html = wrapTemplate('Your Email Address Was Changed', `
              <p style="color:#c8b99a;font-size:15px;line-height:1.7;margin:0 0 24px;">
                The email address on your Console Notebook account has been changed to
                <strong style="color:#e8d5b7;">${safeNew}</strong>.
              </p>
              <p style="color:#c8b99a;font-size:15px;line-height:1.7;margin:0 0 24px;">
                If you made this change, no further action is needed.
                If you did <strong>not</strong> authorise this change, click the button below to reset your password and secure your account immediately.
              </p>
              <a href="${resetLink}" style="display:inline-block;background:#e8d5b7;color:#0a0a14;font-weight:700;font-size:14px;padding:14px 32px;border-radius:8px;text-decoration:none;letter-spacing:0.5px;">
                Secure My Account
              </a>
              <p style="color:#5a5070;font-size:12px;margin:20px 0 0;">
                This reset link expires in 24 hours.
              </p>`);

    try {
        const { data, error } = await resend.emails.send({
            from: FROM,
            to: oldEmail,
            subject: 'Your Console Notebook email address was changed',
            html
        });
        if (error) {
            console.error('Resend error (email-changed-notify):', error);
            return { success: false, error: error.message };
        }
        console.log('Email-changed notification sent to:', oldEmail, '| Id:', data?.id);
        return { success: true };
    } catch (err) {
        console.error('Resend exception (email-changed-notify):', err);
        return { success: false, error: err.message };
    }
}

/**
 * sendPasswordChangedNotification
 * @description Email: security notification sent after a successful password change.
 *              Includes a reset link in case the change was unauthorised.
 */
async function sendPasswordChangedNotification(to, resetToken, baseUrl) {
    const resetLink = String(baseUrl || BASE_URL()).replace(/\/$/, '') + '/html/pages/reset-password.html?token=' + encodeURIComponent(resetToken);
    const html = wrapTemplate('Your Password Was Changed', `
              <p style="color:#c8b99a;font-size:15px;line-height:1.7;margin:0 0 24px;">
                The password for your Console Notebook account was recently changed.
              </p>
              <p style="color:#c8b99a;font-size:15px;line-height:1.7;margin:0 0 24px;">
                If you made this change, no further action is needed.
                If you did <strong>not</strong> change your password, click the button below to reset it and secure your account immediately.
              </p>
              <a href="${resetLink}" style="display:inline-block;background:#e8d5b7;color:#0a0a14;font-weight:700;font-size:14px;padding:14px 32px;border-radius:8px;text-decoration:none;letter-spacing:0.5px;">
                Reset My Password
              </a>
              <p style="color:#5a5070;font-size:12px;margin:20px 0 0;">
                This reset link expires in 24 hours.
              </p>`);

    try {
        const { data, error } = await resend.emails.send({
            from: FROM,
            to,
            subject: 'Your Console Notebook password was changed',
            html
        });
        if (error) {
            console.error('Resend error (password-changed-notify):', error);
            return { success: false, error: error.message };
        }
        console.log('Password-changed notification sent to:', to, '| Id:', data?.id);
        return { success: true };
    } catch (err) {
        console.error('Resend exception (password-changed-notify):', err);
        return { success: false, error: err.message };
    }
}

module.exports = {
    sendVerificationEmail,
    sendPasswordResetEmail,
    sendTwoFactorEmail,
    sendContactEmail,
    sendRepairRequestNotification,
    sendRepairReplyNotification,
    sendFriendRequestNotification,
    sendFriendAcceptedNotification,
    sendSetPasswordEmail,
    sendEmailChangedNotification,
    sendPasswordChangedNotification
};
