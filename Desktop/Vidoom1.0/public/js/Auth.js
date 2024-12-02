let token = window.sessionStorage.getItem('peer_token')

if(!token) {
    window.location.href = '/login'
}