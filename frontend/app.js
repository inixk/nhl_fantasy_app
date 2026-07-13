const tg = window.Telegram.WebApp;
tg.expand();

// 1. Логика Приветственного окна
const welcomeModal = document.getElementById('welcome-modal');
const appContainer = document.getElementById('app-container');

// Проверяем, заходил ли юзер раньше
if (!localStorage.getItem('nhl_onboarding_done')) {
    document.getElementById('start-btn').addEventListener('click', () => {
        localStorage.setItem('nhl_onboarding_done', 'true');
        welcomeModal.style.display = 'none';
        appContainer.style.display = 'block';
    });
} else {
    welcomeModal.style.display = 'none';
    appContainer.style.display = 'block';
}

// 2. Логика Нижнего меню (Tabs)
const navItems = document.querySelectorAll('.nav-item');
const tabContents = document.querySelectorAll('.tab-content');

navItems.forEach(item => {
    item.addEventListener('click', () => {
        // Убираем класс active у всех
        navItems.forEach(nav => nav.classList.remove('active'));
        tabContents.forEach(tab => tab.classList.remove('active'));
        
        // Добавляем нажатому
        item.classList.add('active');
        const targetId = item.getAttribute('data-target');
        document.getElementById(targetId).classList.add('active');
    });
});