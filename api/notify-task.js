/**
 * Vercel Serverless Function — POST /api/notify-task
 *
 * Sends email notification via Resend API when a task is assigned.
 *
 * Body: { to, toName, taskText, taskDescription, prospectName, assignedBy, dueDate, prospectContext, dashboardUrl }
 * Env:  RESEND_API_KEY
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { to, toName, taskText, taskDescription, prospectName, assignedBy, dueDate, prospectContext, dashboardUrl } = req.body || {};

  if (!to || !taskText || !prospectName) {
    return res.status(400).json({ error: 'Missing required fields: to, taskText, prospectName' });
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'RESEND_API_KEY not configured' });
  }

  const dueLine = dueDate ? `<p><strong>Fecha limite:</strong> ${dueDate}</p>` : '';
  const descLine = taskDescription ? `<p><strong>Descripcion:</strong> ${taskDescription}</p>` : '';

  // Truncate context to first 500 chars for email
  let contextBlock = '';
  if (prospectContext) {
    const trimmed = prospectContext.length > 500 ? prospectContext.slice(0, 500) + '...' : prospectContext;
    const escaped = trimmed.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
    contextBlock = `
        <div style="background: #F7F9FC; border: 1px solid #E2E8F0; border-radius: 8px; padding: 14px; margin: 16px 0;">
          <p style="margin: 0 0 6px; font-size: 11px; font-weight: 700; color: #6B7F94; text-transform: uppercase; letter-spacing: 0.5px;">Contexto</p>
          <p style="margin: 0; font-size: 13px; color: #1A2B3D; line-height: 1.5;">${escaped}</p>
        </div>`;
  }

  const linkBlock = dashboardUrl
    ? `<p style="margin: 16px 0 0;"><a href="${dashboardUrl}" style="display: inline-block; padding: 10px 20px; background: linear-gradient(135deg, #8B5CF6, #3B82F6); color: #FFFFFF; text-decoration: none; border-radius: 6px; font-size: 13px; font-weight: 600;">Ver prospect en dashboard</a></p>`
    : '';

  const htmlBody = `
    <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 24px;">
      <div style="background: linear-gradient(135deg, #8B5CF6, #3B82F6); padding: 20px 24px; border-radius: 10px 10px 0 0;">
        <h2 style="margin: 0; color: #FFFFFF; font-size: 18px;">Nueva tarea asignada</h2>
      </div>
      <div style="background: #FFFFFF; padding: 24px; border: 1px solid #E2E8F0; border-top: none; border-radius: 0 0 10px 10px;">
        <p style="color: #6B7F94; font-size: 14px; margin-top: 0;">
          Hola ${toName || to.split('@')[0]},
        </p>
        <p style="color: #1A2B3D; font-size: 14px;">
          Se te ha asignado una tarea en el prospect <strong>${prospectName}</strong>:
        </p>
        <div style="background: #F5F3FF; border: 1px solid #DDD6FE; border-radius: 8px; padding: 16px; margin: 16px 0;">
          <p style="margin: 0 0 4px; font-size: 16px; font-weight: 700; color: #1A2B3D;">
            ${taskText}
          </p>
          ${descLine}
          ${dueLine}
        </div>
        ${contextBlock}
        <p style="color: #6B7F94; font-size: 13px;">
          Asignada por: <strong>${assignedBy}</strong>
        </p>
        ${linkBlock}
        <hr style="border: none; border-top: 1px solid #E2E8F0; margin: 20px 0;">
        <p style="color: #94A3B8; font-size: 11px; margin-bottom: 0;">
          Alter5 BI — Dashboard de inteligencia comercial
        </p>
      </div>
    </div>
  `;

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Alter5 BI <noreply@alter-5.com>',
        to: [to],
        subject: `[Alter5] Tarea asignada: ${taskText} — ${prospectName}`,
        html: htmlBody,
      }),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      console.error('Resend API error:', errData);
      return res.status(response.status).json({ error: errData.message || 'Failed to send email' });
    }

    const data = await response.json();
    return res.status(200).json({ success: true, id: data.id });
  } catch (err) {
    console.error('Email send error:', err);
    return res.status(500).json({ error: err.message || 'Internal error sending email' });
  }
}
