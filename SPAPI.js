//I'm not making a regular of that object because I only want one instance of this
//Not sure if it's the correct way this should have been done

function SPAPI(){

}

SPAPI.storeFuncs = [];
SPAPI.pendingPayloads = [];

SPAPI.addStoreFunc = (storeID, func) => {
	SPAPI.storeFuncs.push({store: storeID, specificFunc: func});
};

SPAPI.createPayload = (nameOfStore)=>{
	var payload = {};
	payload.storeName = nameOfStore;
	return payload;
};

SPAPI.preparePayload = (payload, necessaryElements) => {
	if (payload.storeName === undefined) {
		console.log("Fatal error: payload has no store name in preparePayload!");
		return;
	}

	//Getting the index
	var funcToCall = SPAPI.storeFuncs.map((a)=>{return a.store}).indexOf(payload.storeName);

	if (funcToCall == -1) {
		console.log("Error, couldn't find appropriate function in preparePayload");
		return;
	}

	funcToCall = SPAPI.storeFuncs[funcToCall].specificFunc;

	funcToCall(payload, necessaryElements);

	// console.log("prepared Payload");
	// console.log(payload);
	// At this point, the payload should be filled, we're good but still a check never hurts

	if (payload.itemName === undefined || payload.itemName.length === 0) {
		console.warn("/!\\ Payload doesn't seem to be initialized correctly!");
		return;
	}
};

SPAPI.sendPayload = (payload) => {
	//For some reason, I can't seem to be able to send a message from background script
	//to background script, so I'm using this stupid workaround to ensure the request 
	//is sent from the background page to avoid chrome security troubles and make the
	//server happy too.
	
	// console.log("Payload that should have been sent");
	// console.log(payload);
	// return;

	switch(window.location.protocol)
	{
		case "http:":
		case "https:":
			chrome.runtime.sendMessage({
				action: 'xhttp',
				storeName: payload.storeName,
				productPage: payload.itemID,
				price: payload.itemPrice,
				currency: payload.itemCurrency
			});
			break;

		case "chrome-extension:":
			$.post("http://waxence.fr/skimpenny/add.php", 
			{
				store : payload.storeName,
				product : payload.itemID,
				price : payload.itemPrice,
				currency: payload.itemCurrency
			},
			(response)=>{console.log(response);},
			'text')
			.fail(function(){
				console.log("Error sending request :(");
			});
			break;
	}
};

//Updates the favorite: last time/price seen by user
//TODO use payload
SPAPI.registerLastTimeUserSeen = (payload) => {
	chrome.storage.sync.get(null, (data)=>{
		if (isInFavorites(data.favlist, payload.itemID)) {
			
			var favoriteIndex = data.favlist.map((a)=>{return a.shorturl}).indexOf(payload.itemID);
			
			data.favlist[favoriteIndex].lastUserAcknowledgedDate = new Date().toJSON();
			data.favlist[favoriteIndex].lastUserAcknowledgedPrice = payload.itemPrice;
			data.favlist[favoriteIndex].currency = payload.itemCurrency;

			chrome.storage.sync.set({favlist: data.favlist}, ()=>{console.log("Favorite updated.")});
		}
	});
};

SPAPI.sendSimpleRecord = (nameOfStore, necessaryElements) => {
	var payload = SPAPI.createPayload(nameOfStore);
	SPAPI.preparePayload(payload, necessaryElements);
	SPAPI.sendPayload(payload);
	return payload;
};

/* FUNCTIONS FOR BOTH JS SCRIPTS */

function getUrlPart(url, index) {
   return url.replace(/^https?:\/\//, '').split('/')[index];
}

function getLastUrlPart(fullurl) {
	var shorturl = fullurl.substr(fullurl.lastIndexOf('/') + 1);

	var n = shorturl.indexOf('#');
	shorturl = shorturl.substring(0, n != -1 ? n : shorturl.length);

	n = shorturl.indexOf('?');
	shorturl = shorturl.substring(0, n != -1 ? n : shorturl.length);

	return shorturl;
}

/* FUNCTIONS FOR SKIMPENNY.JS */

//Sends a price record to the database, and updates last time favorite seen
//NOTE: This function must only be called when the user visits a page, no bakground calls!
function addPriceRecord(payload) {
	chrome.runtime.sendMessage({
		action: 'xhttp',
		storeName: payload.storeName,
		productPage: payload.itemID,
		price: payload.itemPrice,
		currency: payload.itemCurrency
	});

	//Updates the favorite: last time/price seen by user
	chrome.storage.sync.get(null, (data)=>{
		if (isInFavorites(data.favlist, payload.itemID)) {
			var favoriteIndex = data.favlist.map((a)=>{return a.shorturl}).indexOf(payload.itemID);
			data.favlist[favoriteIndex].lastUserAcknowledgedDate = new Date().toJSON();
			data.favlist[favoriteIndex].lastUserAcknowledgedPrice = payload.itemPrice;
			data.favlist[favoriteIndex].currency = payload.itemCurrency;

			chrome.storage.sync.set({favlist: data.favlist}, ()=>{console.log("Favorite updated.")});
		}
	});
}

function storeDomainIs(argument) {
	return document.domain.endsWith(argument);
}

/* FUNCTIONS FOR POPUP.JS */

function isInFavorites(favArray, itemID) {
	return favArray === undefined ? false : favArray.map((a)=>{return a.shorturl}).indexOf(itemID) != -1;
}

//Gets the current price of a favorite, and sends it to the database in the background
//Ususally called when user clicks the "Show graph" button when viewing the favorite list
function addRecordBackground(favorite) {
	chrome.runtime.sendMessage({action: "updatefav", fav: favorite});
}

/////////////////////////////////////////////////
//Below are funcs to get data from the database//
/////////////////////////////////////////////////

//builds a graph from an itemID and the storeName
function getPriceCurve(itemID, storeName, datadiv = "#maindiv", selector = "#chart", mini = false){

	$.post("http://waxence.fr/skimpenny/get.php", 
		{
			store : storeName,
			product : itemID,
		},
		(data) => {showResults(data, datadiv, selector, mini);},
		'text')
	.fail(function(xhr, status, error){
		$("#maindiv").html(chrome.i18n.getMessage("error_getting_prices"))
		.css("animation", "none")
		.css("line-height", "100px");

		console.log("Error codes:");
		console.log(status);
		console.log(error);
	});
		
}

/*text: the data retrieved from the server
  datadiv: where to write the data on the page. The css will force it to not be displayed
  selector: in what block to build the graph*/
function showResults(text, datadiv, selector, mini = false){
	$(datadiv).empty().append(text).css("display", "none");
	buildSelectGraph(datadiv, selector, mini);
}

//This function needs A LOT of optimization, there are many loops, and I guess there
//is a more clever way to implement this.
function buildSelectGraph(datadiv = "#maindiv", selector = "#chart", mini = false){
	//STEP ONE: Find all different currencies
	var datearray = [];
	var pricearray = [];
	var recordCurrency;
	var recordDate;
	var recordDate;

	//Fills the array containing the dates
	//Fills the array containing the array with currencies
	$(datadiv + " .priceentry").each((i, element)=>{
		recordCurrency = $(element).find(".currency").text();
		recordDate = $(element).find(".date").text();

		//Avoid having date duplicates
		if (datearray.indexOf(recordDate) === -1) {
			datearray.push(recordDate);
		}

		//pelem = array for one currency
		var currencyInArray = false;
		$(pricearray).each((pi, pelem)=>{
			if(pelem[0] === recordCurrency){
				currencyInArray = true;
				return;
			}
		});
		if (!currencyInArray) {
			pricearray.push([recordCurrency]);
		}
	});
	
	//STEP TWO: Fill an array with adequate size of null values
	//Fills the price arrays with null values
	$(pricearray).each((i, e)=>{
		$.merge(e, new Array(datearray.length).fill(null));
	});

	//STEP THREE: for each record, add the price in the right index
	//For each date, we check each record to see if there is the date matches, and then adds the record
	$(datearray).each((dateIndex, date)=>{
		$(datadiv + " .priceentry").each((recordNumber, element)=>{
			recordCurrency = $(element).find(".currency").text();
			recordDate = $(element).find(".date").text();
			recordPrice = $(element).find(".price").text();

			if (recordDate === date) {
				$(pricearray).each((currencyIndex, currencyArray)=>{
					if (currencyArray[0] === recordCurrency) {
						currencyArray[dateIndex + 1] = recordPrice;
					}
				});
			}
		});
	});

	if (pricearray !== undefined && pricearray.length > 0) {
		buildGraph(pricearray, datearray, selector, mini);
	}
	else{
		$(selector)
		.empty()
		.append(chrome.i18n.getMessage("error_empty_pricelist") + $(datadiv + " #errorDiv").text())
		.css("display", "block")
		.css("font-size", "x-large")
		.css("text-align", "center")
		.css("width", "100%");
	}
}

function buildGraph(pricearray, datearray, selector, mini = false){

	// Create a simple line chart
	var columns = [$.merge(['x'], datearray)];
	$(pricearray).each((i, currencyColumn)=>{
		columns.push(currencyColumn);
	});

	chrome.storage.sync.get({chartStyle: "line"}, (data) =>{
		var chart = c3.generate({
			bindto: selector,
			data: {
				x: 'x',
				columns: columns,
				type: data.chartStyle
			},
			size: {
				height: mini ? 197 : 500,
				width: mini ? 310 : 770
			},
			padding: {
				//We add this padding to prevent labels from getting cropped
				right: 30
			},
			axis: {
				x: {
					type: 'timeseries',
					show: !mini,
					tick: {
						format: '%d/%m/%Y'
					}
				},
				y: {
					show: !mini
				}
			},
			interaction: {
				enabled: !mini
			},
			line: {
				connectNull: true
			}
		});
	});
}