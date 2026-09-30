const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const Kahoot = require('./kahoot.js');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

io.on('connection', (socket) => {
    let client = new Kahoot();
    let autoSolve = false;

    socket.on('join-game', ({ pin, name }) => {
        client.join(pin, name).catch(err => {
            const errorText = typeof err === 'string' ? err : (err.description || err.message || 'Неверный PIN');
            socket.emit('error-msg', 'Ошибка входа: ' + errorText);
        });
    });

    client.on("joined", () => {
        socket.emit('status', 'Успешно вошли в лобби!');
    });

    client.on("QuizStart", () => {
        socket.emit('status', 'Викторина началась!');
    });

    socket.on('toggle-auto', (state) => {
        autoSolve = state;
    });

    client.on("QuestionStart", (question) => {
        socket.emit('question-started', {
            number: question.gameBlockIndex + 1,
            choicesCount: question.quizQuestionAnswers ? question.quizQuestionAnswers[question.gameBlockIndex] : 4
        });

        if (autoSolve) {
            setTimeout(() => {
                question.answer(0);
                socket.emit('status', 'ИИ автоматически отправил ответ!');
            }, 1000);
        }
    });

    client.on("QuizEnd", () => {
        socket.emit('status', 'Викторина завершена.');
    });

    socket.on('manual-answer', (index) => {
        if (client.currentQuestion) {
            client.currentQuestion.answer(index);
            socket.emit('status', `Отвечено вручную: Вариант ${index + 1}`);
        }
    });

    socket.on('disconnect', () => {
        try { client.leave(); } catch (e) {}
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Сервер запущен на сервере http://localhost:${PORT}`);
});
