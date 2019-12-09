var seenSpeechBefore = {};
var seenHintsBefore = {};

class Master {
	constructor() {
		this.database = jsonFiles['database.json'];
		this.seenSpeechBefore = seenSpeechBefore;
		this.seenHintsBefore = seenHintsBefore;
	}

	seen(speechKey) {
		console.log('seen');
		console.log(this.seenSpeechBefore);
		if (!this.seenSpeechBefore) {
			this.seenSpeechBefore = {};
		}

		this.seenSpeechBefore[speechKey] = true;
	}

	speechAvailable() {
		console.log('speechAvailable');
		console.log(this.seenSpeechBefore);
		if (!this.seenSpeechBefore) {
			this.seenSpeechBefore = {};
		}

		var availableKeys = Object.keys(jsonFiles['database.json']);
		var seenKeys = Object.keys(this.seenSpeechBefore);
		if ((availableKeys.length - seenKeys.length) <= 0) {
			return false;
		}
		return true;
	}

	seenBefore(speechKey) {
		console.log('seenBefore');
		console.log(this.seenSpeechBefore);
		if (!this.seenSpeechBefore) {
			this.seenSpeechBefore = {};
		}

		if (speechKey in this.seenSpeechBefore) {
			return true;
		} else {
			return false;
		}
	}

	seenHint(speechKey, hint) {
		console.log('seenHint');
		console.log(this.seenHintsBefore);

		if (!this.seenHintsBefore) {
			this.seenHintsBefore = {};
		}

		if (!(speechKey in this.seenHintsBefore)) {
			this.seenHintsBefore[speechKey] = {};
		}
		this.seenHintsBefore[speechKey][hint] = true;
	}

	hintAvailable(speechKey) {
		console.log('hintAvailable');
		console.log(this.seenHintsBefore);

		if (!this.seenHintsBefore) {
			this.seenHintsBefore = {};
			return true;
		}

		if (!(speechKey in this.seenHintsBefore)) {
			return true;
		}

		var availableHints = jsonFiles['database.json'][speechKey]['hints'];
		var seenHints = Object.keys(this.seenHintsBefore[speechKey]);

		if ((availableHints.length - seenHints.length) <= 0) {
			return false;
		}
		return true;
	}

	seenHintBefore(speechKey, hint) {
		console.log('seenHintBefore');
		console.log(this.seenHintsBefore);

		if (!this.seenHintsBefore) {
			this.seenHintsBefore = {};
			return false;
		}

		if (!(speechKey in this.seenHintsBefore)) {
			return false;
		}
		if (hint in this.seenHintsBefore[speechKey]) {
			return true;
		} else {
			return false;
		}
	}

	getRandomIndex() {
		return Math.floor(Math.random() * Math.floor(Object.keys(jsonFiles['database.json']).length));
	}

	getRandomSpeech() {
		var keys = Object.keys(jsonFiles['database.json']);
		var randomProp = keys[this.getRandomIndex()];
		// console.log(keys);
		// console.log(randomProp);
		this.speechKey = randomProp;
		return randomProp;

	}

	getAccent(speechKey) {
		return jsonFiles['database.json'][speechKey]['accent'];
	}

	getAnswer(speechKey) { // String
		// console.log(this.speechKey);
		return jsonFiles['database.json'][speechKey]['answer'];
	}

	getHint(speechKey) {  // String
		var hints = jsonFiles['database.json'][speechKey]['hints'];
		var randomHint = hints[Math.floor(Math.random() * Math.floor(hints.length))];
		console.log(hints);
		console.log(randomHint);
		return randomHint;
	}

	// validateAnswer(answer, speechKey) {

	// }
}

exports.getPotentialAnswers = function() {
	return {
		name: 'ANSWER_LIST',
		values: [
			"I'll be back",
			"I am your father",
			"I'm going to make him an offer he can't refuse",
			"May the force be with you",
			"You talking to me",
			"Frankly my dear, I don't give a damn",
			"Go ahead make my day",
			"Bond, James Bond",
			"Show me the money",
			"You can't handle the truth",
			"Houston, we have a problem",
			"Elementary my dear Watson",
			"Hasta la vista baby",
			"I am Groot",
			"I want to play a game",
			"This is Sparta",
			"You're a wizard, Harry",
			"Just keep swimming"
		]
	};
}