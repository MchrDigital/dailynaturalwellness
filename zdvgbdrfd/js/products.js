const product = document.querySelectorAll(".products a");

function parseBottles(value) {
	if (value.includes("+")) {
		return value
			.split("+")
			.map(v => parseFloat(v.trim()))
			.reduce((a, b) => a + b, 0);
	}
	return parseFloat(value);
}

product.forEach(function (e) {

	let offer = e.dataset.offer;
	let headline = e.dataset.headline;
	let bottles = parseBottles(e.dataset.bottles);
	let name = typeof e.dataset.name !== 'undefined'
		? e.dataset.name
		: e.dataset.bottles;
	name += " Bottles";
	let supply = typeof e.dataset.supply !== 'undefined'
		? e.dataset.supply
		: bottles * 30;

	let guarantee = e.dataset.guarantee;
	let image = e.dataset.image;
	let total = parseFloat(e.dataset.total);

	let full = typeof e.dataset.full !== 'undefined'
		? parseFloat(e.dataset.full)
		: 179 * bottles;

	let price = formatPrice(total / bottles);

	let shipping = typeof e.dataset.shipping !== 'undefined'
		? `<div class="shipping">+&nbsp;<span>${e.dataset.shipping}</span> ${document.body.classList.contains('digistore24') ? 'US SHIPPING' : 'SHIPPING'}</div>`
		: "";

	let cards = "";
	let savings = full - total;
	let buttonText = "BUY NOW";

	// Format price to 2 decimal places if it is not an integer
	function formatPrice(p) {
		if (p % 1 === 0) {
			return p.toString();
		} else {
			const [intPart, decimalPart] = p.toFixed(2).split('.');
			return `${intPart}<sup class="decimal">.${decimalPart}</sup>`;
		}
	}

	// Change buy button text for upsells
	const platformCompliance = ['cartpanda', 'clickbank'].every(cls =>
		document.body.classList.contains(cls)
	);

	if (e.dataset.buttontext) {
		buttonText = e.dataset.buttontext;
	} else if (
		['upsell1', 'upsell2', 'upsell3', 'downsell1', 'downsell2'].includes(document.body.id)
	) {
		buttonText = platformCompliance
			? "UPGRADE MY ORDER"
			: "ADD TO MY ORDER";
	}

	// Cards for promo vs regular
	if (offer == 'promo') cards = "assets/main/products/img/cards-dark.webp";
	else cards = "assets/main/products/img/cards.webp";

	// Build HTML
	e.innerHTML = `
		<div class="item ${offer}">
			<div class="wrapper">
				<div class="item-header">${headline}</div>
				<div class="item-img">
					<div class="supply"><b>${name}</b>${supply} Day Supply</div>
					<img src="${assetsPath}${image}" alt="${bottles}">
				</div>
				<div class="item-info">
					<div class="price">
						<b><sup>$</sup>${price}</b><span>PER<br>BOTTLE</span>
					</div>
					<div class="savings">
						<div><span>YOU SAVE $${savings}!</span></div>
						<div><span>BIGGEST DISCOUNT</span></div>
						<div><span>${guarantee} DAYS GUARANTEE</span></div>
					</div>
				</div>
				<div class="item-buy">
					<div class="button"><div><span>${buttonText}</span></div></div>
					<img src="${assetsPath}${cards}" alt="Cards" class="card-flags">
				</div>
				<div class="item-totals">
					<div class="totals">Total: <s>$${full}</s> <b>$${total}</b></div>
					${shipping}
				</div>
			</div>
		</div>
	`;
});

// Hide Totals
window.addEventListener('DOMContentLoaded', () => {
	const pageParam = new URLSearchParams(window.location.search).get('pg');
	const bodyClassList = document.body.classList;

	if (
		bodyClassList.contains('clickbank') &&
		!(pageParam || document.body.id === 'vsl' || document.body.id === 'dtc' || document.body.id === 'ecom')
	) {
		document.querySelectorAll(".totals s").forEach(e => e.style.display = "none");
		document.querySelectorAll(".savings").forEach(e => e.style.display = "none");
		document.querySelectorAll(".totals").forEach(e => e.style.fontSize = "1.6em");
	}
});
