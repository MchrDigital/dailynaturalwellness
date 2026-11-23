// Bottles Bought
var stockNumber = 250;
const cNames = ['Jessica', 'James', 'Maria', 'Robert', 'Naomi', 'Samantha', 'Giulia', 'Joseph', 'Emmily', 'Daniel'];
const cLocals = ['California', 'Ohio', 'Pennsylvania', 'Michigan', 'Illinois', 'North Caroline', 'Georgia', 'Florida', 'Texas'];
const tBottles = [3, 6, 6];

function bottlesBuying() {
	const randName = cNames[Math.floor(Math.random() * cNames.length)];
	const randLocal = cLocals[Math.floor(Math.random() * cLocals.length)];
	const randBottle = tBottles[Math.floor(Math.random() * tBottles.length)];

	const oneBottle = document.querySelector('#one-bottle');
	const threeBottles = document.querySelector('#three-bottles');
	const sixBottles = document.querySelector('#six-bottles');

	stockNumber -= randBottle;

	if (randBottle == 3) {
		oneBottle.style.display = 'none';
		threeBottles.style.display = 'block';
		sixBottles.style.display = 'none';
		document.querySelector('#items-purchased').innerHTML = randBottle + ' bottles';
	} else if (randBottle == 6) {
		oneBottle.style.display = 'none';
		threeBottles.style.display = 'none';
		sixBottles.style.display = 'block';
		document.querySelector('#items-purchased').innerHTML = randBottle + ' bottles';
	} else {
		oneBottle.style.display = 'block';
		threeBottles.style.display = 'none';
		sixBottles.style.display = 'none';
		document.querySelector('#items-purchased').innerHTML = randBottle + ' bottle';
	}

	document.querySelectorAll('.stock').forEach(function (e) {
		e.innerHTML = stockNumber;
	});
	document.querySelector('#customer-name').innerHTML = randName;
	document.querySelector('#customer-location').innerHTML = randLocal;
	document.querySelector('.purchases-disclaimer').style.right = '20px';
	setTimeout(function () {
		document.querySelector('.purchases-disclaimer').style.right = '-800px';
	}, 10000);
	if (stockNumber < 25) clearInterval(buyTimer);
}