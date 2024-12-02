let loginbtn1 = document.getElementById('login')
let signUpBtn1 = document.getElementById('signup')
let logOut = document.getElementById('logout')
let account_center = document.getElementById('account-center')
let logOut_center = document.getElementById('logout-center')
let user = window.sessionStorage.getItem('user_name')

if (loginbtn1) {
    loginbtn1.addEventListener('click', () => {
        window.location.href = '/login';
    });
}

if (signUpBtn1) {
    signUpBtn1.addEventListener('click', () => {
        window.location.href = '/register';
    });
}

if (logOut) {
    logOut.addEventListener('click', () => {
        localStorage.clear();
        window.sessionStorage.clear();
        window.location.href = '/login';
    });
}

if (user) {
    if (account_center) {
        account_center.classList.add('d-none');
    }
} else {
    if (logOut) {
        logOut_center.classList.add('d-none')
    }
}