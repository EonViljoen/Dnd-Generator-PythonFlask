const toastTrigger = document.getElementById('puzzleTest')
const toastLiveExample = document.getElementById('liveToast')
var toastResponse = null

if (toastTrigger) {
  const toastBootstrap = bootstrap.Toast.getOrCreateInstance(toastLiveExample)
  toastTrigger.addEventListener('click', () => {
    console.log(toastResponse)
    toastBootstrap.show();
    fetch('http://127.0.0.1:5000/r/Dungeon?arg=Puzzles')
            .then(res => res.json())
            .then(data => {
                toastResponse = data
                console.log(data)
            });
  })
}

// var entryResponse;
        // const toastResponse = document.getElementById('toast-response')
        // console.log(toastResponse)

        // fetch('http://127.0.0.1:5000/r/Dungeon?arg=Puzzles')
        //     .then(res => res.json())
        //     .then(data => {
        //         entryResponse = data
        //         console.log(data)
        //     })
        //     .then(() =>{
        //         console.log(entryResponse)
        //         toastResponse.innerText = 'entryResponse'
        //     })