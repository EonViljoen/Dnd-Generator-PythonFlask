//Card and container generated programmatically, need to integrate with api to generate entire screen programmatically

GenerateScreen()
    .then( result => {
        // const script = GenerateToastScript();

        // document.body.appendChild(script)
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
                var button = GenerateButton(header, element)
                unord_list.appendChild(button);
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

function GenerateEntries(){

}

function GenerateButton(header, title){
    const button = document.createElement('button');
    button.innerText = title;
    button.type = 'button';
    button.className = 'btn btn-outline-dark RandomEntryButton';
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

function GenerateToastScript(){
    const script = document.createElement('script');
    script.src = "../scripts/toasts.js";
    return script;
}