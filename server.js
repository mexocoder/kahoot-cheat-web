const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const Kahoot = require('kahoot.js-updated2');
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
            socket.emit('error-msg', 'Ошибка входа: ' + (err.description || 'Неверный PIN'));
        });
    });

    client.on("joined", () => {
        socket.emit('status', 'Успешно вошли в лобби!');
    });

    socket.on('toggle-auto', (state) => {
        autoSolve = state;
    });

    client.on("QuestionStart", (question) => {
        socket.emit('question-started', {
            number: question.gameBlockIndex + 1,
            choicesCount: question.quizQuestionAnswers[question.gameBlockIndex] || 4
        });

        // Если авто-режим включен — выбираем вариант (например, первый вариант)
        if (autoSolve) {
            setTimeout(() => {
                question.answer(0); // Отвечает на 1-й вариант (Красный)
                socket.emit('status', 'ИИ автоматически отправил ответ!');
            }, 1000);
        }
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
