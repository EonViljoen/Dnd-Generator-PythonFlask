var toastTrigger = document.getElementById('RetrieveRandomEntry');
console.log(toastTrigger)
const toastLiveExample = document.getElementById('liveToast');
var toastResponse = null;

if (toastTrigger) {
  console.log('Triggered')
  const toastBootstrap = bootstrap.Toast.getOrCreateInstance(toastLiveExample)

  toastTrigger.addEventListener('click', () => {
    fetch('http://127.0.0.1:5000/api/r/Dungeon?arg=Puzzles')
            .then(res => res.json())
            .then(data => {
              document.getElementById('toast-response').innerText = data;
            });

            toastBootstrap.show();
  })
}
