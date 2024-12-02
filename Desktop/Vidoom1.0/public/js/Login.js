'use strict';

// CryptoJS allaqachon yuklangan, import yoki require kerak emas
const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password');
const loginBtn = document.getElementById('loginButton');
let loginbtn = document.getElementById('login');
let signUpBtn = document.getElementById('signup');

// Foydalanadigan maxfiy kalit
const secretKey = 'vidoom1.0_secret_key';

usernameInput.onkeyup = (e) => {
    if (e.keyCode === 13) {
        e.preventDefault();
        login();
    }
};

passwordInput.onkeyup = (e) => {
    if (e.keyCode === 13) {
        e.preventDefault();
        login();
    }
};

loginBtn.onclick = (e) => {
    login();
};

function login() {
    const email = filterXSS(document.getElementById('username').value);
    const phone_number = filterXSS(document.getElementById('password').value);

    const qs = new URLSearchParams(window.location.search);
    const room = filterXSS(qs.get('room'));

    // http://localhost:3010/join/test
    const pathParts = window.location.pathname.split('/');
    const roomPath = pathParts[pathParts.length - 1];

    if (email && phone_number) {
        axios
            .post('/login', {
                email: email,
                phone_number: phone_number,
            })
            .then(function (response) {
                // console.log(response);

                // Ma'lumotlarni olish
                const token = response.data.message;
                const userPlan = response.data.plan;

                // `plan` ni shifrlash va localStorage-ga saqlash
                // const encryptedPlan = CryptoJS.AES.encrypt(userPlan, secretKey).toString();
                localStorage.setItem('plan', userPlan);

                // Sessiyaga token va username saqlash
                
                window.sessionStorage.peer_token = token;
                window.sessionStorage.setItem('user_name', email);

                // if (room) {
                //     return (window.location.href = '/join/' + window.location.search);
                //     // return (window.location.href = '/join/?room=' + room + '&token=' + token);
                // }
                // if (roomPath) {
                //     return (window.location.href = '/join/' + roomPath);
                //     // return (window.location.href ='/join/?room=' + roomPath + '&token=' + token);
                // }

                return (window.location.href = '/logged');
            })
            .catch(function (error) {
                console.error(error);
                alert('Unauthorized');
            });
        return;
    }
    if (!email && !phone_number) {
        alert('Email and Password required');
        return;
    }
    if (!email) {
        alert('Email required');
        return;
    }
    if (!phone_number) {
        alert('Password required');
        return;
    }
}