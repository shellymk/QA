// AUDITORIA #4: escapa dados do banco antes de ir pro innerHTML (evita XSS
// caso este componente volte a ser usado no painel).
function escHtml(t) {
  return String(t ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function renderMeetingItem(meeting) {

  const date = new Date(meeting.createdAt).toLocaleString('pt-BR');
  const duration = meeting.duration ? `${Math.round(meeting.duration)} min` : '—';

  return `
    <div class="meeting-card">
      <div class="meeting-info">
        <div class="meeting-title">${escHtml(meeting.title || 'Reunião')}</div>
        <div class="meeting-meta">📅 ${date} &nbsp;·&nbsp; ⏱ ${duration}</div>
      </div>
      <div class="meeting-actions">
        <a href="transcript.html?id=${meeting._id}" class="btn-primary">Ver transcrição</a>
      </div>
    </div>
  `;

}
