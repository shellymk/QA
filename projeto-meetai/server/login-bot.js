/*
================================================
MEETAI — login-bot.js
Execute UMA VEZ para fazer login com a conta bot
e salvar os cookies em bot-auth.json

Como usar:
  node login-bot.js

Após o login, o arquivo bot-auth.json é gerado
e o bot usa ele automaticamente nas próximas vezes.
================================================
*/

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const STORAGE_PATH = path.join(__dirname, 'bot-auth.json');

(async () => {
  console.log('🤖 Iniciando setup do bot...');
  console.log('📁 Cookies serão salvos em:', STORAGE_PATH);

  const browser = await chromium.launch({
    headless: false,
    args: [
      '--window-size=1280,720',
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
    ],
    ignoreDefaultArgs: ['--enable-automation'],
  });

  const context = await browser.newContext({
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  });

  // Remove webdriver flag
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    window.chrome = { runtime: {} };
  });

  const page = await context.newPage();

  console.log('\n========================================');
  console.log('AÇÃO NECESSÁRIA:');
  console.log('1. Uma janela do Chrome vai abrir');
  console.log('2. Faça login com: meetqaautomation.notetaker@gmail.com');
  console.log('3. Após o login, acesse: https://meet.google.com');
  console.log('4. Aceite os termos se aparecerem');
  console.log('5. Volte aqui e pressione ENTER');
  console.log('========================================\n');

  await page.goto('https://accounts.google.com/signin', { waitUntil: 'domcontentloaded' });

  // Aguarda ENTER do usuário
  await new Promise((resolve) => {
    process.stdout.write('Pressione ENTER após fazer o login e acessar meet.google.com... ');
    process.stdin.once('data', resolve);
  });

  // Salva os cookies
  await context.storageState({ path: STORAGE_PATH });
  
  const stats = fs.statSync(STORAGE_PATH);
  console.log(`\n✅ Login salvo com sucesso!`);
  console.log(`📁 Arquivo: ${STORAGE_PATH}`);
  console.log(`📦 Tamanho: ${(stats.size / 1024).toFixed(1)} KB`);
  console.log('\n🚀 O bot está pronto! Pode iniciar o servidor normalmente.');

  await browser.close();
  process.exit(0);
})();