function testFunc(){

var entryResponse;

fetch('http://127.0.0.1:5000/r/Dungeon?arg=Puzzles')
    .then(res => {
        entryResponse = res;
    })
    .then(() =>{
        console.log(entryResponse)
    })
}