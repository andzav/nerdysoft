let app = require('express')();
let server = require('http').createServer(app);
let io = require('socket.io')(server);
let mongoose = require('mongoose');
let jwt = require('jsonwebtoken');
let sha256 = require('sha256');
let cors = require('cors');
let compression = require('compression');
let bodyParser = require('body-parser');
let helmet = require('helmet');

let http = require("http");
setInterval(function() {
    http.get("http://nerdydemo.herokuapp.com/");
}, 300000);

app.use(cors());
app.set('trust proxy', 1);
app.use(compression())
app.use(bodyParser.urlencoded({extended: true}));
app.use(bodyParser.json());
app.use(helmet());
mongoose.connect(process.env.MONGODB_URI, {useNewUrlParser: true});

let User = mongoose.model('User', { email: String, password: String});
let Task = mongoose.model('Task', { title: String, content: String, creator: String, managers: [String]});
let Logs = mongoose.model('Log', { taskID: String, from: String, to: String});

let jwtSecret = process.env.secret || "Nerdysoft";

io.on('connection', function(){ return; });

app.get('/', (req, res) => res.sendFile(__dirname + '/menu.html'));

app.get('/random', (req, res) => res.sendFile(__dirname + '/index.html'));

app.get('/tm', (req, res) => res.sendFile(__dirname + '/taskmanager.html'));

app.get('/api/random', (req, res)=>{
    res.status(200).send(''+parseInt(Math.random() * 100));
});

app.post('/api/login', (req, res) => {
    let login = req.body.email;
    let password = req.body.password;
    if (login && password){
        User.find({'email': login}, async (err, data) => {
            if (err) res.sendStatus(400);
            else{
                if (data.length > 0){
                    if(data[0].password === sha256(password)){
                        res.status(200).json({id: data[0]._id, token: jwt.sign({ _id: data[0]._id + '|' + Date.now() }, jwtSecret)});
                    }else{
                        res.status(400).send('User already exists and/or password is incorect');
                    }
                }else{
                    let user = await User.create({email: login, password: sha256(password)});
                    res.status(200).json({id: user._id, token: jwt.sign({ _id: user._id + '|' + Date.now() }, jwtSecret)});
                }
            }
        });
    }
})

app.get('/api/tasks', async (req, res) => {
    try{
        let userID = jwt.verify(req.query.token, jwtSecret)._id.split('|')[0];
        let user = await User.findById(userID);
        if (user){
            let createdTasks = await Task.find({creator: user._id}, '-creator -managers');
            let managedTasks = await Task.find({managers: user._id}, '-creator -managers').lean();
            for (let i = 0; i < managedTasks.length; i++){
                let connection = await Logs.find({taskID: managedTasks[i]._id, to: user.email});
                managedTasks[i].invitedBy = connection[0].from;
            }
            res.status(200).json([...createdTasks, ...managedTasks]);
        }else{
            res.status(200).send({success: false});
        }
    }catch(e){
        res.status(200).send({success: false});
    }
})

app.post('/api/tasks', async (req, res) => {
    try{
        let userID = jwt.verify(req.body.token, jwtSecret)._id.split('|')[0];
        let user = await User.findById(userID);
        console.log(user, req.body.tasks);
        if (user && req.body.title && req.body.content){
            if (req.body.title.length > 0 && req.body.content.length > 0){
                await Task.create({title: req.body.title, content: req.body.content, creator: userID, managers: []});
            }
            res.status(200).send({success: true});
        }else{
            res.status(200).send({success: false});
        }
    }catch(e){
        res.status(200).send({success: false});
    }
})

app.put('/api/tasks', async (req, res) => {
    try{
        let userID = jwt.verify(req.body.token, jwtSecret)._id.split('|')[0];
        let user = await User.findById(userID);
        let taskID = req.body.id;
        let task = await Task.findById(taskID);
        if (user && task && (task.managers.indexOf(user._id) !== -1 || task.creator == user._id) && req.body.title && req.body.content){
            task.title = req.body.title;
            task.content = req.body.content;
            await task.save();
            res.status(200).send({success: true});
        }else{
            res.status(200).send({success: false});
        }
    }catch(e){
        res.status(200).send({success: false});
    }
})

app.delete('/api/tasks', async (req, res) => {
    try{
        let userID = jwt.verify(req.body.token, jwtSecret)._id.split('|')[0];
        let user = await User.findById(userID);
        let taskID = req.body.id;
        let task = await Task.findById(taskID);
        if (user && task && (task.managers.indexOf(user._id) !== -1 || task.creator == user._id)){
            await task.remove();
            res.status(200).send({success: true});
        }else{
            res.status(200).send({success: false});
        }
    }catch(e){
        console.log(e);
        res.status(200).send({success: false});
    }
})

app.post('/api/share', async (req, res) =>{
    try{
        let userID = jwt.verify(req.body.token, jwtSecret)._id.split('|')[0];
        let taskID = req.body.id;
        let email = req.body.email;
        let user = await User.findById(userID);
        let task = await Task.findById(taskID);;
        if (user && task && (task.managers.indexOf(user._id) !== -1 || task.creator == user._id)){
            let userToAdd = await User.findOne({email: email});
            if (userToAdd && task.managers.indexOf(userToAdd._id) === -1 && task.creator !== userToAdd._id){
                task.managers.push(userToAdd._id);
                await task.save();
                await Logs.create({taskID, from: user.email, to: userToAdd.email});
                io.emit('updatetasks', ''+userToAdd._id)
                res.status(200).send({success: true});
            }else res.status(200).send({success: false});
        }else res.status(200).send({success: false});
    }catch(e){
        res.status(200).send({success: false});
    }
})

server.listen(3000);