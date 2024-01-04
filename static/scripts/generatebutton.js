//Card and container generated programmatically, need to integrate with api to generate entire screen programmatically

var header = 'Dungeon'

const container = document.createElement('div');
container.className = 'container-md text-md-center';

const row = document.createElement('div');
row.className = 'row py-md-3';
container.appendChild(row);

const med_column = document.createElement('div');
med_column.className = 'col-md';
row.appendChild(med_column);

const card = document.createElement('div');
card.className = 'card border-dark';
med_column.appendChild(card);

const card_header = document.createElement('div');
card_header.className = 'card-header';
card_header.innerText = header
card.appendChild(card_header)

const card_body = document.createElement('div');
card_body.className = 'card-body';
card.appendChild(card_body);

const unord_list = document.createElement('ul');
unord_list.className = 'list-group list-group-flush';
card_body.appendChild(unord_list);

const button = document.createElement('button');
button.innerText = 'Puzzles';
button.type = 'button';
button.className = 'btn btn-outline-dark';
button.id = 'puzzleTest';
unord_list.appendChild(button);

document.body.appendChild(med_column);