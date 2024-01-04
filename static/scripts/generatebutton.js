const button = document.createElement('button');
button.innerText = 'Test button';

button.addEventListener('click', () => {
    alert('cool test bro');
})

document.body.appendChild(button);