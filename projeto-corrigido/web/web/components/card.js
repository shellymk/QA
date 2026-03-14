export function renderCard(title, value, icon = '') {
  return `
    <div class="card">
      <h3>${icon ? icon + ' ' : ''}${title}</h3>
      <p>${value ?? '—'}</p>
    </div>
  `;
}
