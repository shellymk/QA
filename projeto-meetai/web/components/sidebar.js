export function renderSidebar(activePage = '') {

  const links = [
    { id: 'dashboard', href: '/index.html',            icon: '🏠', label: 'Dashboard' },
    { id: 'meetings',  href: '/pages/meetings.html',   icon: '📹', label: 'Reuniões' },
    { id: 'analytics', href: '/pages/analytics.html',  icon: '📊', label: 'Analytics' },
    { id: 'settings',  href: '/pages/settings.html',   icon: '⚙️', label: 'Configurações' },
  ];

  const navLinks = links.map(link => {
    const isActive = link.id === activePage ? 'active' : '';
    return `<a href="${link.href}" class="${isActive}">${link.icon} ${link.label}</a>`;
  }).join('');

  return `
    <aside class="sidebar">
      <div class="logo">Meet<span>AI</span></div>
      <nav>${navLinks}</nav>
    </aside>
  `;

}
