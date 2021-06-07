var crypto = require('crypto');
var gcm = require('node-aes-gcm');

function encrypt_aes(unencrypted_bytes, user_key) {
                
  let key = new Buffer.from(user_key, 'hex');         
  //console.log("key, ", key)
                
  let iv = new Buffer.from(process.env.AES_IV, 'hex');              
  //console.log("iv", iv)
                
  let bytes = new Buffer.from(unencrypted_bytes);             
  console.log("plaintext", bytes);
                
  let aad = new Buffer.from(process.env.AES_AAD);             
  //console.log("aad", aad);
                
  let auth_tag = new Buffer.from(process.env.AES_AUTH_TAG);
  //console.log("auth_tag", auth_tag);
  
  encrypted = gcm.encrypt(key, iv, bytes, auth_tag)       
  let encrypted_buffer = encrypted["ciphertext"];
  //console.log(encrypted_buffer);
  let encrypted_output = encrypted_buffer.toJSON().data;
  console.log(" encrypted aes data from buffer to JSON : ", encrypted_output);
  

  return encrypted_output
};

function decrypt_aes(encrypted_bytes, user_key) {
                
  let key = new Buffer.from(user_key, 'hex');         
  //console.log("key, ", key)
                
  let iv = new Buffer.from(process.env.AES_IV, 'hex');              
  //console.log("iv", iv)
                
  let ciphertext = new Buffer.from(encrypted_bytes);             
  console.log("buffer encrypted (ciphertext)", ciphertext);
                
  let aad = new Buffer.from(process.env.AES_AAD);             
  //console.log("aad", aad);
                
  let auth_tag = new Buffer.from(process.env.AES_AUTH_TAG);
  //console.log("auth_tag", auth_tag);
  
  decrypted = gcm.decrypt(key, iv, ciphertext, aad, auth_tag);
  let decrypted_output = decrypted["plaintext"];

  return decrypted_output
};

function hexToBytes(hex) {
    for (var bytes = [], c = 0; c < hex.length; c += 2)
    bytes.push(parseInt(hex.substr(c, 2), 16));
    return bytes;
}

module.exports = {
    encrypt_aes,
    decrypt_aes,
    hexToBytes
}