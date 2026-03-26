export function renderMeetingItem(meeting) {

  const date = new Date(meeting.createdAt).toLocaleString('pt-BR');
  const duration = meeting.duration ? `${Math.round(meeting.duration)} min` : '—';

  return `
    <div class="meeting-card">
      <div class="meeting-info">
        <div class="meeting-title">${meeting.title || 'Reunião'}</div>
        <div class="meeting-meta">📅 ${date} &nbsp;·&nbsp; ⏱ ${duration}</div>
      </div>
      <div class="meeting-actions">
        <a href="transcript.html?id=${meeting._id}" class="btn-primary">Ver transcrição</a>
      </div>
    </div>
  `;

}
