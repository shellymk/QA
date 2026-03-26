export function renderTranscriptItem(item) {

  const time = item.timestamp
    ? new Date(item.timestamp).toLocaleTimeString('pt-BR', {
        hour: '2-digit',
        minute: '2-digit'
      })
    : '';

  return `
    <div class="transcript-line">
      <div class="speaker-label">${item.user || 'Participante'}</div>
      <div class="transcript-content">
        ${time ? `<span class="transcript-time">${time}</span>` : ''}
        <span class="transcript-text">${item.text || ''}</span>
      </div>
    </div>
  `;

}
