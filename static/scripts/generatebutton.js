GenerateScreen()
    .then( result => {
});

async function GenerateScreen(){
    const container = GenerateContainer();
    var row = GenerateRow(container);;
    var card_header_list;
    
    await FetchHeadings()
        .then( result => {
            card_header_list = result;
    
            var counter = 0;
            for (const element of card_header_list) {
                if (counter % 2 === 0 && counter !== 0){
                    row = GenerateRow(container);
                }
                
                GenerateCard(row, element);
                counter++; 
            }
        });
    
    document.body.appendChild(container);
    return document.body;   
}

function GenerateCard(row, header){
    
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

    FetchSubHeadings(header)
        .then( result => {
            button_texts = result;

            for(const element of button_texts){

                var row = document.createElement('div');
                row.className = 'row';

                var col1 = document.createElement('div');
                col1.className = 'col';
                col1.style = 'padding-right: 0px';
                var randomButton = GenerateRandomButton(header, element);
                col1.appendChild(randomButton);

                var col2 = document.createElement('div');
                col2.className = 'col-auto';
                col2.style = 'padding-left: 0px';
                var additionalButton = GenerateEntriesButton(header, element);
                col2.appendChild(additionalButton);

                row.appendChild(col1);
                row.appendChild(col2);

                var listItem = document.createElement('li');
                listItem.className = 'list-group-item';
                listItem.appendChild(row);

                unord_list.appendChild(listItem);
            }
        })
}

function GenerateRow(container){
    const row = document.createElement('div');
    row.className = 'row py-md-3';
    container.appendChild(row);
    return row;
}

function GenerateContainer(){
    const container = document.createElement('div');
    container.className = 'container-md text-md-center';
    return container;
}


function GenerateRandomButton(header, title){
    const button = document.createElement('button');
    button.innerText = title;
    button.type = 'button';
    button.className = 'btn btn-outline-dark btn-block RandomEntryButton ';
    button.style = 'width: 100%';
    button.id = 'RetrieveRandomEntry';

    button.addEventListener('click', () => {
        const toastLiveExample = document.getElementById('liveToast');
        const toastBootstrap = bootstrap.Toast.getOrCreateInstance(toastLiveExample)

        fetch('http://127.0.0.1:5000/api/r/' + header + '?arg=' + title)
            .then(res => res.json())
            .then(data => {
                document.getElementById('toast-response').innerText = data;
            });

            toastBootstrap.show();
    });

    
    return button;
}

function GenerateEntriesButton(header, title){
    const button = document.createElement('button');
    button.innerText = "Entries";
    button.className  = 'btn btn-outline-danger';
    button.style = 'float: right; height: 100%;';

    
    button.setAttribute('data-bs-target', '#exampleModal');
    button.setAttribute('data-bs-toggle', 'modal');
    

    button.addEventListener('click', async () => {
        DisplayEntryModal(title, await FetchEntries(header, title));
    });


    return button;

}

function DisplayEntryModal(title, entries){
    document.getElementById('exampleModalLabel').innerText = title;

    const modalBody = document.getElementById('entryContent');
    modalBody.innerText = '';

    for (const element in entries){
        modalBody.innerHTML += `<p><strong>${element}:</strong> ${entries[element]}</p>`;
    }
}

async function FetchHeadings(){
    const response = await fetch('http://127.0.0.1:5000/api/Headings');
    const resJson = await response.json();
    return resJson;
    // add error handling
}

async function FetchSubHeadings(heading){
    const response = await fetch('http://127.0.0.1:5000/api/SubHeadings?category=' + heading);
    const resJson = await response.json();
    return resJson;
}

async function FetchEntries(header, title){
    const response = await fetch('http://127.0.0.1:5000/api/' + header + '?arg=' + title);
    const resJson = await response.json().then( val => document.getElementById('entryContent').innerText = val); //Find a better way of doing this
    return resJson;
}

function GenerateToastScript(){
    const script = document.createElement('script');
    script.src = "../scripts/toasts.js";
    return script;
}