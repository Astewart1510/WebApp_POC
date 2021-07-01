# Web-App POC - TrustedHealth

This web-app forms part of the second part of my Proof of Concept: TrustedHealth. TrustedHealth is a privacy-preserving application for the storage of sensitive medical documents. The system outsources the cryptographic functions to an Intel SGX enclave run on a second server before storage and retrieval. Therefore producing a solution where users can store and share their sensitive health documents online without loss of privacy. 

This app is build using a nodejs express server combined with ejs templating for the frontend POC. As mentioned above it is to be run in conjuction with the first part of the thesis which a rust server hosting an Intel SGX enclave - the details for installing and setting up the enclave locally can be found here - https://github.com/Astewart1510/POC_Enclave. 

# Installation and Setup

This project using the latest nodejs and npm package manager to run. Please download and install nodejs and npm here - https://nodejs.org/en/download/.

## Getting Started

Once installed please navigate to the project directory of this cloned repo:

### 1. `npm install`

Install all the needed packages inside the project directory.

### 2. `node app.js run`

Runs the app in the development mode.
Open [http://localhost:3000](http://localhost:3000) to view it in the browser.

Please wait until you see `Server started on port 3000.` and `Database connected successfully!` in your terminal before naviagating the web app.

You can install nodemon via the npm package manager and run the app - `nodemon app.js`. This will reload the server everytime a change is saved.
You will also see any lint errors in the console.

# Notes for Runnning the Web App

* The app is connected to a free mongodb cluster instance in the cloud where the data is stored. The api key to get into the cluster has only read and write access for that specific cluster. There is a free 550MB cap on the cluster storage. So if there are any storage errors or mongodb errors please make sure you are deleting unused files and user profiles after you have tried the POC. 
* The app needs to communicate with the local hosted Intel SGX server. This server needs to be running at the same time. 
