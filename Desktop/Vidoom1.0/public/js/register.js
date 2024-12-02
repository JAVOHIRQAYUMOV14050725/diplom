// Tarif tugmalarini olish
let main = document.getElementById('register-form');
let basicBtn = document.getElementById('basicBtn');
let proBtn = document.getElementById('proBtn');
let enterpriseBtn = document.getElementById('enterpriseBtn');
let pricingSection = document.querySelector('.pricing');
let heroSection = document.getElementById('registerSection');
let image = '../images/locked.png';
let selectedPlan = ''; // Bu o'zgaruvchi tanlangan tarifni saqlaydi
let paymentSection = document.getElementById('paymentSection');
let requestData = {};

// nextBtn tugmasi bosilganda kiritilgan ma'lumotlarni jo'natish
let nextBtn = document.getElementById('nextStep');
let nameInput = document.getElementById('name');  // Ism input
let surnameInput = document.getElementById('surname');  // Familiya input
let emailInput = document.getElementById('email');  // Email input
let phoneInput = document.getElementById('phone_number');  // Telefon raqam input
let innInput = document.getElementById('inn');

// submitBtn tugmasi bosilganda ma'lumotlarni jo'natish
let submitBtn = document.getElementById('submitBtn')
let amount = document.getElementById('amount');
let mm_yy = document.getElementById('mm-yy');
let cardNumber = document.getElementById('card-number');

let icon = {
    warning: '<i class="fa-solid fa-lock"></i>',
    unlock: '<i class="fa-solid fa-lock-open"></i>',
};

// Basic plan uchun button
basicBtn.addEventListener('click', () => {
    hidePricingShowForm('basic');
});

// Pro plan uchun button
proBtn.addEventListener('click', () => {
    hidePricingShowForm('pro');
});

// Enterprise plan uchun button
enterpriseBtn.addEventListener('click', () => {
    hidePricingShowForm('enterprise');
});

// Pricingni yashirish va formani ko'rsatish
function hidePricingShowForm(plan) {
    selectedPlan = plan; // Tanlangan tarifni saqlash
    main.classList.remove('d-flex');
    pricingSection.style.display = 'none';  // Tariflarni yashirish
    heroSection.classList.remove('d-none'); // Formani ko'rsatish

    console.log('Tanlangan tarif: ' + plan); // Tanlangan planni consolega chiqarish
}

// Checkbox checked bo'lganda INN inputni ko'rsatish yoki yashirish
document.getElementById('legalEntityCheckbox').addEventListener('change', function () {
    const innField = document.getElementById('innField');
    if (this.checked) {
        innField.style.display = 'block';  // Ko'rinadi
    } else {
        innField.style.display = 'none';  // Yashirinadi
    }
});

// Next button bosilganda kiritilgan ma'lumotlarni tekshirish va keyingi sahifaga o'tish
nextBtn.addEventListener('click', () => {
    let isLegalEntity = document.getElementById('legalEntityCheckbox').checked;  // Checkbox qiymati

    // Kiritilgan qiymatlarni tekshirish
    if (!nameInput.value || !surnameInput.value || !emailInput.value || !phoneInput.value) {
        popupHtmlMessage(
            'warning',
            "E'tibor bering!",
            "Formadagi hamma ma'lumot to'ldirilishi kerak<br>" +
            `${!nameInput.value ? "Ism kiritilmagan<br>" : ''}` +
            `${!surnameInput.value ? "Familiya kiritilmagan<br>" : ''}` +
            `${!emailInput.value ? "Email kiritilmagan<br>" : ''}` +
            `${!phoneInput.value ? "Telefon raqami kiritilmagan<br>" : ''}`,
            'center',
            null
        );
        return;
    }

    // Agar yuridik shaxs bo'lsa, INN talab qilinadi
    if (isLegalEntity && !innInput.value) {
        popupHtmlMessage(
            'warning',
            "E'tibor bering!",
            "Yuridik shaxslar uchun INN kiritilishi kerak",
            'center'
        );
        return;
    }

    // JSON formatida jo'natiladigan ma'lumotlar
    requestData = {
        name: nameInput.value,
        surname: surnameInput.value,
        email: emailInput.value,
        phone_number: phoneInput.value,
        plan: selectedPlan
    };

    // Agar yuridik shaxs bo'lsa, INN ni ham qo'shamiz
    if (isLegalEntity) {
        requestData.inn = innInput.value;
    } else {
        delete requestData.inn;
    }

    // Qoldirilgan tarif qiymatini ko'rsatish
    amount.value = selectedPlan == 'basic' ? '$9' : selectedPlan == 'pro' ? '$29' : '$89';
    paymentSection.classList.remove('d-none');
    heroSection.classList.add('d-none');
});

// Kartaning raqamini formatlash
cardNumber.addEventListener('input', function (e) {
    let value = e.target.value.replace(/\D/g, '');
    if (value.length > 16) {
        value = value.slice(0, 16);
    }
    value = value.replace(/(.{4})/g, '$1 ').trim();
    e.target.value = value;
});

// Oy va yilni kiritish uchun alohida event listener
mm_yy.addEventListener('input', function (e) {
    let value = e.target.value.replace(/\D/g, '');
    if (value.length > 4) {
        value = value.slice(0, 4);
    }

    // Oy (birinchi ikki raqam) 12 dan katta bo'lmasin
    let month = value.slice(0, 2);
    if (month > 12) {
        month = '12';
    }

    let year = value.slice(2);

    // Format: MM / YY
    if (value.length >= 2) {
        value = `${month} / ${year}`;
    }

    e.target.value = value;
});

// Submit tugmasi bosilganda ma'lumotlarni serverga jo'natish
submitBtn.addEventListener('click', () => sendRequest(requestData));

function sendRequest(data) {
    const serverUrl = `${window.location.origin}`;
    axios.post(`${serverUrl}/register`, data)
        .then(response => {
            popupHtmlMessage(
                null, "Pul to'landi va Akkaount ochildi", null, 'center', null
            );
            console.log('Muvaffaqiyat:', response);
            if (response.status === 201) {
                setTimeout(() => {
                    window.location.href = '/login';
                }, 2000);
            }
        })
        .catch(error => {
            console.error('Xato:', error);
            // Check if the error response is available
            if (error.response) {
                console.error('Error Response:', error.response.data);
                alert('Xato ro\'y berdi: ' + error.response.data.message || error.message);
            } else {
                alert('Xato ro\'y berdi: ' + error.message);
            }
        });
}

// Pop-up ko'rsatish uchun funksiya
function popupHtmlMessage(icon, title, html, position, imageUrl = null) {
    Swal.fire({
        allowOutsideClick: false,
        allowEscapeKey: false,
        background: '#f2f2f2',
        position: position || 'center',
        icon: icon,
        imageUrl: imageUrl,
        title: title,
        html: html,
        showClass: { popup: 'animate__animated animate__fadeInDown' },
        hideClass: { popup: 'animate__animated animate__fadeOutUp' },
    });
}