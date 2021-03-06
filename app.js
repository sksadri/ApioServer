"use strict";
var express = require("express");
var path = require("path");
var logger = require("morgan");
var cookieParser = require("cookie-parser");
var bodyParser = require("body-parser");
var http = require("http");
var app = express();
var Apio = require("./apio.js");
var fs = require('fs');
var domain = require('domain');
var async = require('async');
var request = require('request');
var net = require('net');
var targz = require('tar.gz');
var formidable = require('formidable');

var APIO_CONFIGURATION = {
    port : 8083
}
var ENVIRONMENT = "production";
if (process.argv.indexOf('--no-serial') > -1)
    ENVIRONMENT = "development"
if (process.argv.indexOf('--http-port') > -1) {
    var index = process.argv.indexOf('--http-port');
    APIO_CONFIGURATION.port = process.argv[index+1];
}
if (process.argv.indexOf('--serial-port') > -1) {
    var index = process.argv.indexOf('--serial-port');
    Apio.Serial.Configuration.port = process.argv[index+1];
}


var HOST = '192.168.1.109';
var PORT = 6969;

var routes = {};
routes.dashboard = require('./routes/dashboard.route.js');
routes.core = require('./routes/core.route.js');



var d = domain.create();
// Because req and res were created before this domain existed,
    // we need to explicitly add them.
    // See the explanation of implicit vs explicit binding below.


    //Il domain è un "ambiente chiuso" in cui far finire gli errori per non crashare il server
    //L'alternativa è fail fast e restart ma non mi piace
d.on('error',function(err){
    //Apio.Util.debug("Apio.Server error : "+err);
    //Apio.Util.debug(err.stack);
    Apio.Util.printError(err);
});

d.run(function(){


function puts(error, stdout, stderr) {
    sys.puts(stdout);
}


if (ENVIRONMENT == 'production')
    Apio.Serial.init();

Apio.Socket.init(http);
Apio.Database.connect(function(){
    /*
    Inizializzazione servizi Apio
    Fatti nel callback della connessione al db perchè ovviamente devo avere il db pronto come prima cosa
    */

    Apio.System.resumeCronEvents(); //Ricarica dal db tutti i cron events
});

// view engine setup
app.set("views", path.join(__dirname, "views"));
app.set("view engine", "jade");


app.use(logger("dev"));
app.use(bodyParser.json({limit: '50mb'}));
app.use(bodyParser.urlencoded({limit: '50mb', extended: true}));
/*
app.use(bodyParser.json());
app.use(bodyParser.urlencoded());
*/
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));


app.get('/',function(req,res){
    res.sendfile('public/html/index.html');
})
app.post('/apio/authenticate',function(req,res){
    var user = req.body.user;
    var password = req.body.password;

    if (user === 'apio' && password === 'apio')
        res.send({
            status : true
        })
    else
        res.status(401).send({
            status : false,
            errors : [{
                code : 401,
                message : 'Username or password did not match.'
            }]
        })
})

app.post('/apio/adapter',function(req,res){
                var req_data = {
                        json : true,
                        uri : req.body.url,
                        method : "POST",
                        body : req.body.data
                }
                console.log("\n\n /apio/adapter sending the following request")
                console.log(req_data);
                console.log("\n\n")
                var _req = request(req_data,function(error,response,body){

                        if ('200' === response.statusCode || 200 === response.statusCode) {
                            console.log("Apio Adapter method : got the following response from "+req.body.url)
                            console.log(body);
                            res.send(body)
                        }
                        else {
                            console.log("Apio Adapter : Something went wrong ")
                            res.status(response.statusCode).send(body);
                        }
                });
})

app.get("/dashboard",routes.dashboard.index);


/*Shutdown*/
    app.get('/apio/shutdown', function(req, res){
        var sys = require('sys');
        var exec = require('child_process').exec;
        var child = exec("sudo shutdown -h now", function (error, stdout, stderr) {
            //sys.print('stdout: '+stdout);
            //sys.print('stderr: '+stderr);
            if (error !== null) {
                console.log('exec error: '+error);
            }
        });
    });



/*
*   Crea un nuovo evento
**/
app.post("/apio/event",routes.core.events.create);

app.get('/apio/notifications',routes.core.notifications.list);
app.get('/apio/notifications/listDisabled',routes.core.notifications.listdisabled);
app.post('/apio/notifications/markAsRead',routes.core.notifications.delete);
app.post('/apio/notifications/disable',routes.core.notifications.disable);
app.post('/apio/notifications/enable',routes.core.notifications.enable);
app.get('/apio/notify/:message',function(req,res){
    Apio.System.notify({objectId : "4545", objectName : "Piantana", message : "ciao", properties : {onoff : "1"}, timestamp : new Date().getTime()});
    res.send({});
});

    app.post('/apio/notify',function(req,res){
        var numero_dita = req.body.finger;
        var json;
        if ('undefined' !== typeof numero_dita) {
            json = {
                objectId : '9',
                objectName : 'ManoSve',
                message : 'La Raspberry ha rilevato '+numero_dita+' dita.',
                properties : {
                    dita : numero_dita
                },
                timestamp : new Date().getTime()
            };
            Apio.System.notify(json)
        } else {
            console.log("Dita undefined")
        }

        res.send({});



        var incomingState = json;
        console.log("+++++++++++++++++++++++++++++\n\n")
        console.log("Ricevuta richiesta di stato ")
        console.log(incomingState);

        var stateHistory = {};

        var getStateByName = function(stateName,callback) {
            Apio.Database.db.collection('States').findOne({name : stateName},callback);
        };
        //Mi applica lo stato se non è già stato applicato
        /*var applyStateFn = function(stateName) {

            console.log("\n\nApplico lo stato "+stateName+"\n\n")
            if (!stateHistory.hasOwnProperty(stateName)) { //se non è nella history allora lo lancio
                getStateByName(stateName,function(err,state){
                    if (err) {
                        console.log("applyState unable to apply state")
                        console.log(err);
                    }
                    else if(state){
                        if (state.active == true){
                            Apio.Database.db.collection('States').update({name : state.name},{$set : {active : false}},function(errOnActive){
                                if (errOnActive) {
                                    console.log("Impossibile settare il flag dello stato");
                                    res.status(500).send({error : "Impossibile settare il flag dello stato"})
                                } else {
                                    var s = state;
                                    s.active = false;
                                    Apio.io.emit('apio_state_update',s);
                                    res.send({error:false});
                                }
                            })
                        }
                        else {
                            Apio.Database.db.collection('States').update({name : state.name},{$set : {active : true}},function(err){
                                if (err)
                                    console.log("Non ho potuto settare il flag a true");
                            })
                            console.log("Lo stato che sto per applicare è ")
                            console.log(state)
                            Apio.Database.updateProperty(state,function(){
                                stateHistory[state.name] = 1;
                                //Connected clients are notified of the change in the database
                                Apio.io.emit("apio_server_update",state);
                                if (ENVIRONMENT == 'production') {
                                    Apio.Serial.send(state, function(){
                                        console.log("SONO LA CALLBACK");
                                        //Ora cerco eventuali eventi
                                        Apio.Database.db.collection("Events").find({triggerState : state.name}).toArray(function(err,data){
                                            if (err) {
                                                console.log("error while fetching events");
                                                console.log(err);
                                            }
                                            console.log("Ho trovato eventi scatenati dallo stato "+state.name);
                                            console.log(data)
                                            //data è un array di eventi
                                            data.forEach(function(ev,ind,ar){
                                                var states = ev.triggeredStates;
                                                states.forEach(function(ee,ii,vv){
                                                    applyStateFn(ee.name);
                                                })
                                            })
                                            res.send({});
                                        })
                                        pause(500);
                                    });
                                }
                                else{
                                    Apio.Database.db.collection("Events").find({triggerState : state.name}).toArray(function(err,data){
                                        if (err) {
                                            console.log("error while fetching events");
                                            console.log(err);
                                        }
                                        console.log("Ho trovato eventi scatenati dallo stato "+state.name);
                                        console.log(data)
                                        //data è un array di eventi
                                        data.forEach(function(ev,ind,ar){
                                            var states = ev.triggeredStates;
                                            states.forEach(function(ee,ii,vv){
                                                applyStateFn(ee.name);
                                            })
                                        })
                                        res.send({});
                                    })
                                    pause(500);
                                }
                            });
                        }
                    }
                })
            } else {
                console.log("Skipping State application because of loop.")
            }
        } //End of applyStateFn*/
        var arr = [];
        var applyStateFn = function(stateName, callback, eventFlag) {
            console.log("\n\nApplico lo stato "+stateName+"\n\n")
            if (!stateHistory.hasOwnProperty(stateName)) { //se non è nella history allora lo lancio
                getStateByName(stateName,function(err,state){
                    if (err) {
                        console.log("applyState unable to apply state")
                        console.log(err);
                    }
                    else if(eventFlag){
                        arr.push(state);
                        Apio.Database.db.collection('States').update({name : state.name},{$set : {active : true}},function(err){
                            if (err)
                                console.log("Non ho potuto settare il flag a true");
                        });
                        console.log("Lo stato che sto per applicare è ");
                        console.log(state);
                        Apio.Database.updateProperty(state,function(){
                            stateHistory[state.name] = 1;
                            //Connected clients are notified of the change in the database
                            Apio.io.emit("apio_server_update",state);
                            Apio.Database.db.collection("Events").find({triggerState : state.name}).toArray(function(err,data){
                                if (err) {
                                    console.log("error while fetching events");
                                    console.log(err);
                                }
                                console.log("Ho trovato eventi scatenati dallo stato "+state.name);
                                console.log(data);
                                if(callback && data.length == 0){
                                    callback();
                                }
                                //data è un array di eventi
                                data.forEach(function(ev,ind,ar){
                                    var states = ev.triggeredStates;
                                    states.forEach(function(ee,ii,vv){
                                        applyStateFn(ee.name, callback, true);
                                    })
                                });
                                res.send({});
                            });
                        });
                    }
                    else{
                        if (state.active == true){
                            Apio.Database.db.collection('States').update({name : state.name},{$set : {active : false}},function(errOnActive){
                                if (errOnActive) {
                                    console.log("Impossibile settare il flag dello stato");
                                    res.status(500).send({error : "Impossibile settare il flag dello stato"})
                                } else {
                                    var s = state;
                                    s.active = false;
                                    Apio.io.emit('apio_state_update',s);
                                    res.send({error:false});
                                }
                            })
                        }
                        else {
                            arr.push(state);
                            Apio.Database.db.collection('States').update({name : state.name},{$set : {active : true}},function(err){
                                if (err)
                                    console.log("Non ho potuto settare il flag a true");
                            });
                            console.log("Lo stato che sto per applicare è ");
                            console.log(state);
                            Apio.Database.updateProperty(state,function(){
                                stateHistory[state.name] = 1;
                                //Connected clients are notified of the change in the database
                                Apio.io.emit("apio_server_update",state);
                                Apio.Database.db.collection("Events").find({triggerState : state.name}).toArray(function(err,data){
                                    if (err) {
                                        console.log("error while fetching events");
                                        console.log(err);
                                    }
                                    console.log("Ho trovato eventi scatenati dallo stato "+state.name);
                                    console.log(data);
                                    if(callback && data.length == 0){
                                        callback();
                                    }
                                    //data è un array di eventi
                                    data.forEach(function(ev,ind,ar){
                                        var states = ev.triggeredStates;
                                        states.forEach(function(ee,ii,vv){
                                            applyStateFn(ee.name, callback, true);
                                        })
                                    });
                                    res.send({});
                                });
                            });
                        }
                    }
                })
            } else {
                console.log("Skipping State application because of loop.")
            }
        }; //End of applyStateFn

        applyStateFn(incomingState.message, function(){
            if(ENVIRONMENT == "production") {
                var pause = function (millis) {
                    var date = new Date();
                    var curDate = null;
                    do {
                        curDate = new Date();
                    } while (curDate - date < millis);
                };
                console.log("arr vale:");
                console.log(arr);
                for (var i in arr) {
                    Apio.Serial.send(arr[i], function () {
                        pause(100);
                    });
                }
                arr = [];
            }
        }, false);

    });

/* Returns all the events */
app.get("/apio/event",routes.core.events.list)
/* Return event by name*/
app.get("/apio/event/:name",routes.core.events.getByName)

app.delete("/apio/event/:name",routes.core.events.delete)

app.put("/apio/event/:name",routes.core.events.update);

/****************************************************************
****************************************************************/

app.post("/apio/state/apply",function(req,res){
    function pause(millis) {
        var date = new Date();
        var curDate = null;
        do{
            curDate = new Date();
        }while(curDate-date < millis);
    }

    var incomingState = req.body.state;

        var stateHistory = {};

        var getStateByName = function(stateName,callback) {
            Apio.Database.db.collection('States').findOne({name : stateName},callback);
        }
        //Mi applica lo stato se non è già stato applicato
        /*var applyStateFn = function(stateName) {
            console.log("\n\nApplico lo stato "+stateName+"\n\n");
            if (!stateHistory.hasOwnProperty(stateName)) { //se non è nella history allora lo lancio
                getStateByName(stateName,function(err,state){
                    if (err) {
                        console.log("applyState unable to apply state");
                        console.log(err);
                    }
                    else if (state.active == true){
                        Apio.Database.db.collection('States').update({name : state.name},{$set : {active : false}},function(errOnActive){
                            if (errOnActive) {
                                console.log("Impossibile settare il flag dello stato");
                                res.status(500).send({error : "Impossibile settare il flag dello stato"})
                            } else {
                                var s = state;
                                s.active = false;
                                Apio.io.emit('apio_state_update',s);
                                res.send({error:false});
                            }
                        })
                    }
                    else {
                        Apio.Database.db.collection('States').update({name : state.name},{$set : {active : true}},function(err){
                            if (err)
                                console.log("Non ho potuto settare il flag a true");
                        });
                        console.log("Lo stato che sto per applicare è ");
                        console.log(state);
                        Apio.Database.updateProperty(state,function(){
                            stateHistory[state.name] = 1;
                            //Connected clients are notified of the change in the database
                            Apio.io.emit("apio_server_update",state);
                            if (ENVIRONMENT == 'production') {
                                Apio.Serial.send(state, function(){
                                    console.log("SONO LA CALLBACK");
                                    //Ora cerco eventuali eventi
                                    Apio.Database.db.collection("Events").find({triggerState : state.name}).toArray(function(err,data){
                                        if (err) {
                                            console.log("error while fetching events");
                                            console.log(err);
                                        }
                                        console.log("Ho trovato eventi scatenati dallo stato "+state.name);
                                        console.log(data)
                                        //data è un array di eventi
                                        data.forEach(function(ev,ind,ar){
                                            var states = ev.triggeredStates;
                                            states.forEach(function(ee,ii,vv){
                                                applyStateFn(ee.name);
                                            })
                                        })
                                    });
                                    pause(500);
                                });
                            }
                            else{
                                Apio.Database.db.collection("Events").find({triggerState : state.name}).toArray(function(err,data){
                                    if (err) {
                                        console.log("error while fetching events");
                                        console.log(err);
                                    }
                                    console.log("Ho trovato eventi scatenati dallo stato "+state.name);
                                    console.log(data);
                                    //data è un array di eventi
                                    data.forEach(function(ev,ind,ar){
                                        var states = ev.triggeredStates;
                                        states.forEach(function(ee,ii,vv){
                                            applyStateFn(ee.name);
                                        })
                                    })
                                });
                                pause(500);
                            }
                        });
                    }

                })
            } else {
                console.log("Skipping State application because of loop.")
            }
        }; //End of applyStateFn*/
    var arr = [];
    var applyStateFn = function(stateName, callback, eventFlag) {
        console.log("***********Applico lo stato "+stateName+"************");
        if (!stateHistory.hasOwnProperty(stateName)) { //se non è nella history allora lo lancio
            getStateByName(stateName,function(err,state){
                if (err) {
                    console.log("applyState unable to apply state");
                    console.log(err);
                }
                else if(eventFlag){
                    arr.push(state);
                    Apio.Database.db.collection('States').update({name : state.name},{$set : {active : true}},function(err){
                        if (err) {
                            console.log("Non ho potuto settare il flag a true");
                        }
                        else {
                            var s = state;
                            s.active = true;
                            Apio.io.emit('apio_state_update',s);
                        }
                    });
                    console.log("Lo stato che sto per applicare è "+state.name);
                    //console.log(state);
                    Apio.Database.updateProperty(state,function(){
                        stateHistory[state.name] = 1;
                        //Connected clients are notified of the change in the database
                        Apio.io.emit("apio_server_update",state);
                        Apio.Database.db.collection("Events").find({triggerState : state.name}).toArray(function(err,data){
                            if (err) {
                                console.log("error while fetching events");
                                console.log(err);
                            }
                            console.log("Ho trovato eventi scatenati dallo stato "+state.name);
                            console.log(data);
                            if(callback && data.length == 0){
                                callback();
                            }
                            //data è un array di eventi
                            data.forEach(function(ev,ind,ar){
                                var states = ev.triggeredStates;
                                console.log("states vale:");
                                console.log(states)
                                states.forEach(function(ee,ii,vv){
                                    applyStateFn(ee.name, callback, true);
                                })
                            })
                        });
                    });
                }
                else{
                    if (state.active == true){
                        Apio.Database.db.collection('States').update({name : state.name},{$set : {active : false}},function(errOnActive){
                            if (errOnActive) {
                                console.log("Impossibile settare il flag dello stato");
                                res.status(500).send({error : "Impossibile settare il flag dello stato"})
                            } else {
                                var s = state;
                                s.active = false;
                                Apio.io.emit('apio_state_update',s);
                            }
                        })
                    }
                    else {
                        arr.push(state);
                        Apio.Database.db.collection('States').update({name : state.name},{$set : {active : true}},function(err){
                            if (err) {
                                console.log("Non ho potuto settare il flag a true");
                            }
                            else {
                                var s = state;
                                s.active = true;
                                Apio.io.emit('apio_state_update',s);
                            }
                        });
                        console.log("Lo stato che sto per applicare è ");
                        //console.log(state);
                        Apio.Database.updateProperty(state,function(){
                            stateHistory[state.name] = 1;
                            //Connected clients are notified of the change in the database
                            Apio.io.emit("apio_server_update",state);
                            Apio.Database.db.collection("Events").find({triggerState : state.name}).toArray(function(err,data){
                                if (err) {
                                    console.log("error while fetching events");
                                    console.log(err);
                                }
                                console.log("Ho trovato eventi scatenati dallo stato "+state.name);
                                console.log(data);
                                if(callback && data.length == 0){
                                    callback();
                                }
                                //data è un array di eventi
                                data.forEach(function(ev,ind,ar){
                                    var states = ev.triggeredStates;
                                    console.log("states vale:");
                                    console.log(states)
                                    states.forEach(function(ee,ii,vv){
                                        applyStateFn(ee.name, callback, true);
                                    })
                                })
                            });
                        });
                    }
                }
            })
        } else {
            console.log("Skipping State application because of loop.")
        }
    }; //End of applyStateFn
        applyStateFn(incomingState.name, function(){
            console.log("applyStateFn callback")
            if(ENVIRONMENT == "production") {
                var pause = function (millis) {
                    var date = new Date();
                    var curDate = null;
                    do {
                        curDate = new Date();
                    } while (curDate - date < millis);
                };
                //console.log("arr vale:");
                //console.log(arr);
                for (var i in arr) {
                    console.log("Mando alla seriale la roba numero "+i)
                    Apio.Serial.send(arr[i], function () {
                        pause(100);
                    });

                }
                res.send({});
                arr = [];
            } else {
                res.send({});
            }
        }, false);
    });

app.delete("/apio/state/:name",function(req,res){
    console.log("Mi arriva da eliminare questo: "+req.params.name)
    Apio.Database.db.collection("States").findAndRemove({name : req.params.name}, function(err,removedState){
        if (!err) {
            Apio.io.emit("apio_state_delete", {name : req.params.name});
            Apio.Database.db.collection("Events").remove({triggerState : req.params.name}, function(err){
                if(err){
                    res.send({error : 'DATABASE_ERROR'});
                }
                else{
                    Apio.io.emit("apio_event_delete", {name : req.params.name});
                }
            });
            if (removedState.hasOwnProperty('sensors')) {

              removedState.sensors.forEach(function(e,i,a){
                var props = {};
                props[e] = removedState.properties[e];
                Apio.Serial.send({
                  'objectId' : removedState.objectId,
                  'properties' : props
                })

              })


            }

            res.send({error : false});
        }
        else
            res.send({error : 'DATABASE_ERROR'});
    })
})


app.put("/apio/state/:name",function(req,res){
    console.log("Mi arriva da modificare questo stato: "+req.params.name);
    console.log("Il set di modifiche è ")
    console.log(req.body.state);

    var packagedUpdate = { properties : {}};
    for (var k in req.body.state) {
        packagedUpdate.properties[k] = req.body.state[k];
    }

    Apio.Database.db.collection("States").update({name : req.params.name},{$set : packagedUpdate},function(err){
        if (!err) {
            Apio.io.emit("apio_state_update",{name : req.params.name, properties : req.body.state});
            res.send({error : false});
        }
        else
            res.send({error : 'DATABASE_ERROR'});
    })
})


/*
    Creazione stato
 */
app.post("/apio/state",routes.core.states.create);


/*
    Returns state list
 */
app.get("/apio/state",routes.core.states.get);
/*
Returns a state by its name
 */
app.get("/apio/state/:name",routes.core.states.getByName);



app.get("/app",function(req,res){
    res.sendfile("public/html/app.html");
})


/*
*   Lancia l'evento
*/
app.get("/apio/event/launch",routes.core.events.launch)
/*
*   restituisce la lista degli eventi
*/
app.get("/apio/event",routes.core.events.list)

/// error handlers

// development error handler
// will print stacktrace
/*
if (app.get("env") === "development" || ENVIRONMENT === "development") {
    app.use(function(err, req, res, next) {
        res.status(err.status || 500);
        console.log("========== ERROR DETECTED ===========")
        console.log(err);
        res.send({
            status : false,
            errors: [{message : err.message}]
        });
        //Da testare
        next();
    });
}



// production error handler
// no stacktraces leaked to user
app.use(function(err, req, res, next) {
    res.status(err.status || 500);
    res.send({status : false});
    console.log(err);
    //Da testare
    next();
});
*/


//FIXME andrebbero fatte in post per rispettare lo standard REST
/*
app.post('/apio/serial/send',function(req,res){

         var keyValue = req.body.message;
            if (req.body.isSensor === true)
                keyValue = 'r'+keyValue;
            var keyValue = keyValue.slice(0,-1);
            var tokens = keyValue.split(":");
            var props = {};
            props[tokens[0]] = tokens[1];

            var obj = {
                objectId: req.body.objectId,
                properties : props
            };
            console.log("Questo è loggetto che arriva da /apio/serial/send")
            console.log(obj);

            Apio.Serial.send(obj);
            res.send();
});
*/
app.post('/apio/serial/send',function(req,res){

            var obj = req.body.data;
            console.log("\n\n%%%%%%%%%%\nAl seria/send arriva questp")
            console.log(obj)
            console.log("\n%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%\n\n")
            Apio.Serial.send(obj);
            res.send({status : true});
});



/* APIO creation and export of the .tar container of the App */
app.get('/apio/app/export', routes.dashboard.exportApioApp);

/* APIO export of the arduino sketchbook file NUOVA*/
app.get('/apio/app/exportIno', routes.dashboard.exportInoApioApp);

/* APIO upload of the App */
app.post('/apio/app/upload', routes.dashboard.uploadApioApp);

/* APIO recovery of the actual maximum id in mongo -> apio -> Objects */
app.post('/apio/app/maximumId', routes.dashboard.maximumIdApioApp);

/* APIO delete of the App */
app.post('/apio/app/delete', routes.dashboard.deleteApioApp);

/* APIO make an empty App folder */
app.post('/apio/app/folder', routes.dashboard.folderApioApp);

/* APIO modify of the App */
app.post('/apio/app/modify', routes.dashboard.modifyApioApp);

/*APIO update of the application for a specified object*/
app.post('/apio/database/updateApioApp', routes.dashboard.updateApioApp);

/*APIO creation of the new ino html js mongo files from the wizard*/
app.post('/apio/database/createNewApioAppFromEditor', routes.dashboard.createNewApioAppFromEditor);

/*APIO creation of the new ino html js mongo files from the wizard*/
app.post('/apio/database/createNewApioApp', routes.dashboard.createNewApioApp);


app.get('/apio/database/getObjects',routes.core.objects.get);
app.get('/apio/database/getObject/:id',routes.core.objects.getById);

app.patch('/apio/object/:id',routes.core.objects.update);
app.put('/apio/object/:id',routes.core.objects.update);



//Handling Serial events and emitting
//APIO Serial Port Listener
//module.exports = app;
/*
*   Socket listener instantiation
*/
Apio.io.on("connection", function(socket){
    socket.on("input", function(data){
        console.log(data);
        Apio.Database.updateProperty(data, function(){
            socket.broadcast.emit("apio_server_update_", data);
        });
        Apio.Serial.send(data);
    });

    console.log("a socket connected");
    socket.join("apio_client");

    socket.on("apio_client_update",function(data){

        console.log("+++++++++++++++++++++++++++++++++++++++++++++++++++++++++++");
        console.log("App.js on(apio_client_update)  received a message");

        //Loggo ogni richiesta
        //Commentato per capire cosa fare con sti log
        //Apio.Logger.log("EVENT",data);

        //Scrivo sul db
        if (data.writeToDatabase === true) {
            Apio.Database.updateProperty(data, function () {
                //Connected clients are notified of the change in the database
                socket.broadcast.emit("apio_server_update", data);
                console.log("data vale: ");
                console.log(data);
                console.log("data.properties vale:");
                console.log(data.properties);

            });
        }
        else
            Apio.Util.debug("Skipping write to Database");


        //Invio i dati alla seriale se richiesto
        if (data.writeToSerial === true && ENVIRONMENT == 'production') {
            Apio.Serial.send(data);
        }
        else
            Apio.Util.debug("Skipping Apio.Serial.send");



    });
});


Apio.io.on("disconnect",function(){
    console.log("Apio.Socket.event A client disconnected");
});



var server = http.createServer(app);


Apio.io.listen(server);
server.listen(APIO_CONFIGURATION.port,function() {
console.log("APIO server started on port "+APIO_CONFIGURATION.port);
});




});
