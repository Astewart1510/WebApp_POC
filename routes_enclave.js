const axios = require("axios");


 const seal_encrypted_data = async encrypted_bytes => {
    try {
      const response = await axios.post('http://localhost:9000//seal_encrypted_data', {
        "unsealed_data_received": encrypted_bytes 
      }, {maxContentLength: 1000000000,
        maxBodyLength: 1000000000
      });
      console.log("response from seal_encrypted_data",response.data);
      //console.log(respone.data["unsealed_data_sentback"]);
      const sealed_data = response.data;
      return sealed_data;
                                
    } catch (errors) {
      console.error(errors);
    }
 };

 const unseal_encrypted_data = async sealed_data => {
    try {
      const response = await axios.post('http://localhost:9000//unseal_encrypted_data', { "sealed_data_received": sealed_data }, {
        maxContentLength: 1000000000,
        maxBodyLength: 1000000000
      });
      console.log("response from unseal_encrypted_data",response.data);
      const unsealed_data = response.data;
      return unsealed_data;
                                
    } catch (errors) {
      //console.error(errors);
    }
 };

  
module.exports = {
  seal_encrypted_data,
  unseal_encrypted_data
}