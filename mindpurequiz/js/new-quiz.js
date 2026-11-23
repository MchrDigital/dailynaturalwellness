const totalSteps = 5;
let currentStep = 1;
let answers = { goals: [], age: '', currentWeight: '', weight: '', symptoms: [] };


document.addEventListener("DOMContentLoaded", function () {

    // evita submit nos botões
    document.querySelectorAll('#quiz-wrapper button').forEach(btn => {
        btn.setAttribute("type", "button");
    });

    const quiz = document.getElementById("quiz-wrapper");
    if (quiz) {
        quiz.scrollIntoView({
            behavior: "smooth",
            block: "start"
        });
    }

});
function toggleMulti(btn, stepNum) {
    btn.classList.toggle('selected');
    const stepEl = document.getElementById('step-' + stepNum);
    const nextBtn = document.getElementById('next-' + stepNum);
    if (!nextBtn) return;

    nextBtn.classList.toggle('visible', stepEl.querySelectorAll('.option-btn.selected').length > 0);

    if (stepNum === 1)
        answers.goals = Array.from(stepEl.querySelectorAll('.option-btn.selected'))
            .map(b => b.querySelector('.opt-label').childNodes[0].textContent.trim());

    if (stepNum === 5)
        answers.symptoms = Array.from(stepEl.querySelectorAll('.option-btn.selected'))
            .map(b => b.querySelector('.opt-label').childNodes[0].textContent.trim());
}

function autoAdvance(btn, stepNum, field, value, nextNum) {
    document.getElementById('step-' + stepNum)
        .querySelectorAll('.option-btn')
        .forEach(b => b.classList.remove('selected'));

    btn.classList.add('selected');
    answers[field] = value;

    setTimeout(() => goNext(nextNum), 360);
}

function goNext(n) {
    document.getElementById('step-' + currentStep).classList.remove('active');
    currentStep = n;

    const el = document.getElementById('step-' + n);
    el.classList.add('active');
    void el.offsetWidth;
    el.classList.add('step-enter');

    setProgress(n);

    const quiz = document.getElementById("quiz-wrapper");

    if (quiz) {
        quiz.scrollIntoView({
            behavior: "smooth",
            block: "start"
        });
    }
}

function goBack(n) {
    document.getElementById('step-' + currentStep).classList.remove('active');
    currentStep = n;

    const el = document.getElementById('step-' + n);
    el.classList.add('active');
    void el.offsetWidth;
    el.classList.add('step-enter');

    setProgress(n);

    const quiz = document.getElementById("quiz-wrapper");

    if (quiz) {
        quiz.scrollIntoView({
            behavior: "smooth",
            block: "start"
        });
    }
}

function setProgress(n) {
    const pct = Math.round((n / totalSteps) * 100);

    const fill = document.getElementById('progress-fill');
    const stepLabel = document.getElementById('step-label');
    const pctLabel = document.getElementById('pct-label');

    if (fill) fill.style.width = pct + '%';
    if (stepLabel) stepLabel.textContent = 'Step ' + n + ' of ' + totalSteps;
    if (pctLabel) pctLabel.textContent = pct + '%';
}

function restartQuiz() {

    const quiz = document.getElementById("quiz-wrapper");
    if (quiz) quiz.style.display = "block";

    const perguntas = document.getElementById("perguntas");
    if (perguntas) perguntas.style.display = "block";

    const status = document.getElementById("quizStatus");
    if (status) {

        status.classList.remove("show");

        const col = status.closest(".col-12");
        if (col) col.style.display = "none";
    }

    const result = document.getElementById("result");
    if (result) result.classList.remove("active");

    document.querySelectorAll('.step').forEach(step => {
        step.classList.remove('active');
    });

    currentStep = 1;

    const first = document.getElementById('step-1');
    if (first) {
        first.classList.add('active');
    }

    setProgress(1);
}

function showResult() {

    document.getElementById('step-' + currentStep).classList.remove('active');

    currentStep = 'loading';

    const loadingEl = document.getElementById('loading');
    loadingEl.classList.add('active');
    void loadingEl.offsetWidth;
    loadingEl.classList.add('step-enter');

    const fill = document.getElementById('progress-fill');
    const stepLabel = document.getElementById('step-label');
    const pctLabel = document.getElementById('pct-label');

    if (fill) fill.style.width = '90%';
    if (stepLabel) stepLabel.textContent = 'Almost there...';
    if (pctLabel) pctLabel.textContent = '90%';

    const quiz = document.getElementById("quiz-wrapper");

    if (quiz) {
        quiz.scrollIntoView({
            behavior: "smooth",
            block: "start"
        });
    }

    const messages = [
        'Reviewing your profile...',
        'Calculating your dosage...',
        'Preparing your personalized formula...'
    ];

    const textEl = document.getElementById('loading-text');
    let msgIndex = 0;

    const msgInterval = setInterval(() => {
        msgIndex++;

        if (msgIndex < messages.length) {
            textEl.style.animation = 'none';
            void textEl.offsetWidth;
            textEl.style.animation = 'fadeSwap 0.4s ease both';
            textEl.textContent = messages[msgIndex];
        }

    }, 2000);

    setTimeout(() => {

        clearInterval(msgInterval);
        buildResult();
        finalize();

    }, 6500);
}

function finalize() {

    const loadingEl = document.getElementById("loading");
    const fill = document.getElementById("progress-fill");
    const stepLabel = document.getElementById("step-label");
    const pctLabel = document.getElementById("pct-label");

    if (loadingEl) loadingEl.classList.remove("active");

    if (fill) fill.style.width = "100%";
    if (stepLabel) stepLabel.textContent = "Complete!";
    if (pctLabel) pctLabel.textContent = "100%";


    const perguntas = document.getElementById("perguntas");
    const status = document.getElementById("quizStatus");

    if (perguntas) perguntas.style.display = "none";

    const quizContent = document.querySelector(".quiz-steps");

    if (quizContent) {
        quizContent.style.display = "none";
    }

    if (status) {

        const col = status.closest(".col-12");
        if (col) col.style.display = "block";

        status.classList.add("show");
    }

    if (typeof window.jQuery !== "undefined") {

        var $scrollTarget = $("#quizStatus");

        if ($scrollTarget.length) {
            $("html, body").animate(
                { scrollTop: $scrollTarget.offset().top },
                800
            );
        }

    } else {

        document.getElementById("quizStatus")?.scrollIntoView({
            behavior: "smooth"
        });

    }
}

function showAfterQuiz() {

    const quiz = document.querySelector(".quiz-status");
    const quizw = document.getElementById("quiz-wrapper");
    const afterQuiz = document.querySelector(".after-quiz");

    if (quiz) {
        quiz.style.display = "none";
    }

    if (quizw) {
        quizw.style.display = "none";
    }

    if (afterQuiz) {
        afterQuiz.style.display = "block";

        afterQuiz.scrollIntoView({
            behavior: "smooth",
            block: "start"
        });
    }

}


function buildResult() {
    const { goals, age, currentWeight, weight, symptoms } = answers;


    /* mostrar step RESULT */
    const loading = document.getElementById("loading");
    if (loading) loading.classList.remove("active");

    const result = document.getElementById("result");
    if (result) {
        result.classList.add("active");
        void result.offsetWidth;
        result.classList.add("step-enter");
    }

    /* Profile rows */
    const ageLabel = { '18–24': '18–24 years old', '25–34': '25–34 years old', '35–44': '35–44 years old', '45–54': '45–54 years old', '55+': '55+ years old' };
    const goalStr = goals.length ? goals.join(', ') : 'General wellness';
    const symptomStr = symptoms.filter(s => s !== 'None of the above').join(', ');
    document.getElementById('profile-rows').innerHTML =
        `<div class="profile-line">🎯 <strong>Goal:</strong> ${goalStr}</div>
       <div class="profile-line">👤 <strong>Age:</strong> ${ageLabel[age] || age}</div>
       <div class="profile-line">⚖️ <strong>Current weight:</strong> ${currentWeight}</div>
       <div class="profile-line">📉 <strong>Weight to lose:</strong> ${weight}</div>
       ${symptomStr ? `<div class="profile-line">⚠️ <strong>Symptoms:</strong> ${symptomStr}</div>` : ''}`;

    /* Projection — always the same */
    document.getElementById('projection-content').innerHTML =
        `<span class="projection-number">18–29 lbs in the first 30 days</span>
       <div class="projection-body">That's just month one. Women with your profile and commitment to the full 6-month treatment have lost 65+ lbs — and kept it off for good.</div>`;


}

window.finalize = finalize;