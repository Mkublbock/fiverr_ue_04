/*jslint node: true */
/*jslint esversion: 6*/
/*jslint eqeqeq: true */

/* global require */

(function () {
    "use strict";

    const express = require("express");
    const app = express();
    const fs = require("fs");

    const https = require('https');
    const privateKey = fs.readFileSync('../https/ia.key', 'utf8');
    const certificate = fs.readFileSync('../https/ia.crt', 'utf8');
    const credentials = {
        key: privateKey,
        cert: certificate
    };

    const httpsServer = https.createServer(credentials, app);


    const bodyParser = require("body-parser");
    const jwt = require("jsonwebtoken");
    const cors = require("cors");
    const simulation = require("./simulation.js");

    let user;
    let available;
    let devices = {};

    app.use(bodyParser.urlencoded({
        extended: true
    }));
    app.use(bodyParser.json());
    app.use(cors());

    app.get("/devices/available", getAvailable);
    app.post("/authentication", authenticate);
    app.put("/password", changePassword);
    app.post("/token", verifyTokenOnStartup);

    app.get("/devices", getDevices);
    app.post("/devices", addDevice);
    app.delete("/devices/:index", deleteDevice);
    app.patch("/devices/:index", moveDevice);
    app.post("/devices/:index/successors", addSuccessor);
    app.delete("/devices/:predecessor/successors/:successor", deleteSuccessor);

    // TODO Create a WebSocket that clients can connect to
    const WebSocketServer = require('ws').Server,
        wss = new WebSocketServer({
            port: 40510
        });

    wss.on('connection', function (ws) {
        ws.on('message', function (message) {
            const jsn = JSON.parse(message);
            sendUpdatedValue(jsn.index, jsn.value);
            wss.clients.forEach(function each(client) {
                if (client !== ws) {
                    client.send(message);
                }
            });
        })

        //ws.send("hello Client, i am the server")
    })

    // TODO Check validity of JWT tokens on requests

    /**
     * Send the list of available devices to the client
     * @param req The request
     * @param res The response
     */

    function getAvailable(req, res) {
        if (!checkBearerToken(req)) {
            res.status(500).json({
                message: "Token is invalid"
            });
        } else {
            if (!available) {
                res.status(500).json({
                    message: "Devices not loaded"
                });
            } else {
                res.status(200).json(available);
            }
        }

    }

    /**
     * Send the list of previously added devices to the client
     * @param req The request
     * @param res The response
     */
    function getDevices(req, res) {
        if (!checkBearerToken(req)) {
            res.status(500).json({
                message: "Token is invalid"
            });
        } else {
            res.status(200).json(Object.keys(devices).map(index => devices[index]));
        }
    }

    /**
     * Add a new device
     * @param req The request
     * @param res The response
     */
    function addDevice(req, res) {
        if (!checkBearerToken(req)) {
            res.status(500).json({
                message: "Token is invalid"
            });
        } else {
            if (devices[req.body.index]) {
                res.status(415).json({
                    message: "Device already exists"
                });
            } else {
                devices[req.body.index] = {
                    index: req.body.index,
                    type: req.body.type,
                    title: req.body.title,
                    position: req.body.position,
                    control: req.body.control,
                    successors: req.body.successors || []
                };
                res.status(200).json({
                    message: "Device added"
                });
            }
        }
    }

    /**
     * Delete a previously added device
     * @param req The request
     * @param res The response
     */
    function deleteDevice(req, res) {
        if (!checkBearerToken(req)) {
            res.status(500).json({
                message: "Token is invalid"
            });
        } else {
            if (!devices[req.params.index]) {
                res.status(404).json({
                    message: "Device does not exist"
                });
            } else {
                delete devices[req.params.index];
                Object.entries(devices).forEach(([key, device]) => deleteArrayEntry(device.successors, +req.params.index));
                res.status(200).json({
                    message: "Device deleted"
                });
            }
        }

    }
    /**
     * Update a device's position
     * @param req The request
     * @param res The response
     */
    function moveDevice(req, res) {
        if (!checkBearerToken(req)) {
            res.status(500).json({
                message: "Token is invalid"
            });
        } else {
            if (!devices[req.params.index]) {
                res.status(404).json({
                    message: "Device does not exist"
                });
            } else {
                devices[req.params.index].position = req.body.position;
                res.status(200).json({
                    message: "Device position updated"
                });
            }
        }
    }

    /**
     * Add a connection between two devices
     * @param req The request
     * @param res The response
     */
    function addSuccessor(req, res) {
        if (!checkBearerToken(req)) {
            res.status(500).json({
                message: "Token is invalid"
            });
        } else {
            if (!devices[req.params.index]) {
                res.status(404).json({
                    message: "Start device does not exist"
                });
            } else if (!devices[req.body.index]) {
                res.status(400).json({
                    message: "End does not exist"
                });
            } else {
                devices[req.params.index].successors.push(req.body.index);
                res.status(200).json({
                    message: "Arrow added"
                });
            }
        }
    }

    /**
     * Delete a connection between two devices
     * @param req The request
     * @param res The response
     */
    function deleteSuccessor(req, res) {
        if (!checkBearerToken(req)) {
            res.status(500).json({
                message: "Token is invalid"
            });
        } else {
            const device = devices[req.params.predecessor];
            if (device) {
                deleteArrayEntry(device.successors, +req.params.successor);
            }
            res.status(200).json({
                message: "Arrow deleted"
            });
        }
    }

    function deleteArrayEntry(array, entry) {
        const index = array.indexOf(entry);
        if (index >= 0) {
            array.splice(index, 1);
        }
    }


    /**
     * Authenticate the user specified in the request
     * @param req The request
     * @param res The response
     */
    function authenticate(req, res) {
        const username = req.body.username,
            password = req.body.password;
        if (!user) {
            res.status(500).json({
                message: "User data not loaded"
            });
        } else if (!username || !password) {
            res.status(400).json({
                message: "Bad request"
            });
        } else if (username !== user.username || password !== user.password) {
            res.status(401).json({
                message: "Bad credentials",
                errors: {
                    credentials: true
                }
            });
        } else {
            var token = generateToken(username);
            res.status(200).json({
                message: "Successfully logged in",
                token: token
            })
        }

    }

    function verifyTokenOnStartup(req, res) {
        const token = req.body.token;
        console.log(token);

        if (token) {
            var decoded = jwt.decode(token);
            if (Date.now() / 1000 > decoded.exp) {
                res.send(JSON.stringify('Token Expired'));
            } else {
                res.send(JSON.stringify('Token Valid'));
            }

        } else {
            res.status(500).json({
                message: "No Token provided"
            });
        }
    }

    function validateToken(token) {
        var decoded = jwt.verify(token, 'secret');
        console.log(decoded);
        return decoded != null ? true : false;
    }

    function getTokenFromHeader(req) {
        const authorization = req.headers.authorization;
        const length = authorization.length;
        return authorization.slice(8, length - 1);
    }

    function checkBearerToken(req) {
        var token = getTokenFromHeader(req);
        return validateToken(token);
    }


    function generateToken(username) {
        return jwt.sign({
            exp: Math.floor(Date.now() / 1000 + (60 * 60)), // 1 hour
            data: username
        }, 'secret');
    }

    /**
     * Change the users password and store it to the login config file
     * @param req The request
     * @param res The response
     */
    function changePassword(req, res) {
        if (!checkBearerToken(req)) {
            res.status(500).json({
                message: "Token is invalid"
            });
        } else {
            const oldPassword = req.body.oldPassword,
                newPassword = req.body.newPassword;

            if (!user) {
                res.status(500).json({
                    message: "User data not loaded"
                });
            } else if (!oldPassword || !newPassword) {
                res.status(400).json({
                    message: "Bad request"
                });
            } else if (oldPassword !== user.password) {
                res.status(400).json({
                    message: "Old password wrong",
                    errors: {
                        oldPassword: true
                    }
                });
            } else {
                const data = `username: ${user.username}\npassword: ${newPassword}`;
                fs.writeFile("./resources/login.config", data, {}, function (err) {
                    if (err) {
                        console.log("Error writing user config: ", err);
                        res.status(500).json({
                            message: "Password could not be stored"
                        });
                    } else {
                        user.password = newPassword;
                        res.status(200).json({
                            message: "Password successfully updated"
                        });
                    }
                });
            }
        }
    }

    /**
     * Send the updated value to all connected WebSocket clients
     * @param {number} index The index of the updated device
     * @param value The new value for the device
     */
    function sendUpdatedValue(index, value) {

        devices[index].control = value
        // TODO Send the data to connected WebSocket clients

    }

    /**
     * Read the user data from the login config file, parse it and store it in 'user'
     */
    function readUser() {
        fs.readFile("./resources/login.config", "utf8", function (err, data) {
            if (err) {
                console.log("Error reading user config: ", err);
            } else {
                const lines = data.split(/\r?\n/),
                    userLine = lines[0],
                    passwordLine = lines[1],
                    username = userLine.substr(userLine.indexOf(":") + 2),
                    password = passwordLine.substr(passwordLine.indexOf(":") + 2);
                user = {
                    username: username,
                    password: password
                };
            }
        });
    }

    /**
     * Read the available devices data from the json file and store it in 'available'
     */
    function readAvailable() {
        fs.readFile("./resources/devices.json", "utf8", function (err, data) {
            if (err) {
                console.log("Error reading available devices: ", err);
            } else {
                available = JSON.parse(data).devices;
            }
        });
    }

    const server = app.listen(8081, function () {
        readUser();
        readAvailable();
        simulation.simulateSmartProduction(devices, sendUpdatedValue);
        const host = server.address().address;
        const port = server.address().port;
        console.log("Big Smart Production Server listening at http://%s:%s", host, port);
    });

    httpsServer.listen(8084, function () {
        readUser();
        readAvailable();
        simulation.simulateSmartProduction(devices, sendUpdatedValue);

        const host = httpsServer.address().address;
        const port = httpsServer.address().port;
        console.log("Big Smart Production Server listening at https://%s:%s", host, port);
    });
})();