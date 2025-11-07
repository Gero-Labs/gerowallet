import { describe, it, expect } from 'vitest';
import axios from 'axios';
import { serialize } from '../src/services/zkFold/utils/json.utils';

describe('zkFold Wallet Activation', () => {
  it('should activate wallet with provided proof data', async () => {
    // Use the exact proof_bytes data provided by the user
    const requestData = {
      "jwt": "eyJhbGciOiJSUzI1NiIsImtpZCI6ImI1ZTQ0MGFlOTQxZTk5ODFlZTJmYTEzNzZkNDJjNDZkNzMxZGVlM2YiLCJ0eXAiOiJKV1QifQ.eyJpc3MiOiJodHRwczovL2FjY291bnRzLmdvb2dsZS5jb20iLCJhenAiOiIyNTk3Mjc2NDU5ODMtazM1ZnFkdG01amJsNTZ1OGh0cjI2Y2hkdWRraGg1NTkuYXBwcy5nb29nbGV1c2VyY29udGVudC5jb20iLCJhdWQiOiIyNTk3Mjc2NDU5ODMtazM1ZnFkdG01amJsNTZ1OGh0cjI2Y2hkdWRraGg1NTkuYXBwcy5nb29nbGV1c2VyY29udGVudC5jb20iLCJzdWIiOiIxMDIwMzkwMDA2NzU3MzM0Nzg0NjciLCJlbWFpbCI6ImVkcmlkdWRpQGdtYWlsLmNvbSIsImVtYWlsX3ZlcmlmaWVkIjp0cnVlLCJhdF9oYXNoIjoiMjV4NGhuY19aemQtb1JBM3FRWkpoUSIsIm5vbmNlIjoiNjBlZ2ptbXVjNjYiLCJuYmYiOjE3NjIyOTYxNzgsIm5hbWUiOiJEdWRpIEVkcmkiLCJwaWN0dXJlIjoiaHR0cHM6Ly9saDMuZ29vZ2xldXNlcmNvbnRlbnQuY29tL2EvQUNnOG9jTEY4bkVlZkdDd3JYS3RmZEhpRmV0eTdlYXF0cjk5QzVJeUdxZDJTLUNSRTZ0XzhpUTVnZz1zOTYtYyIsImdpdmVuX25hbWUiOiJEdWRpIiwiZmFtaWx5X25hbWUiOiJFZHJpIiwiaWF0IjoxNzYyMjk2NDc4LCJleHAiOjE3NjIzMDAwNzgsImp0aSI6IjU4Y2JiNDI4MzRhNDY4OWY1Nzg4OTE2MzIzZTI0NTllM2VjZTYxM2UifQ",
      "payment_key_hash": "59ee644c6da3506ca247955e3d2f6e8239321725fd5c2340fcf85c40",
      "proof_bytes": {
        "a_xi_int": BigInt("51921468631813973577797226576739617133433948101184845903709673917653673272778"),
        "b_xi_int": BigInt("49016845302334935024906232599067614385421367495933503331537117455771619521970"),
        "c_xi_int": BigInt("26496259016440340589379405024974953653860866047736864343244632317917624957179"),
        "cmA_bytes": "a0ce466506194782dc5ffccc5e114c99e148bd8b99619e1aeeae3c497de872953768fe123084be5eeb28390179ee9f14",
        "cmB_bytes": "ad81cc13c1493c1fccca58fccb14a17b025a71b1f861e52c691a444d0885dba86595f44224b6c8bc717cde3663535578",
        "cmC_bytes": "81fd08c2b21d79d999d4c04faea7eb4885d5b77e5c12e5c3a57f944a4f0cc1e9624b6f8e751d1887ab7e4e20fa96078e",
        "cmF_bytes": "968de589ff905dabc8f79f1bd0b31b86154ffa347c05ddcafa5f9ad095c48e12b24dc94e1ef3c7f50925452d0961d3ee",
        "cmH1_bytes": "aafc669cd3f828582492f6e697ee0ba778aff558af9bf6cdac8802c481cfd869f0fa4ac254b0317f30abe2d055b5c3dd",
        "cmH2_bytes": "89c92ef4c02195e4b41bbd35b7a8724f0115b5ad36640c9a8395b5774d7ad38cef40bfe5116900f8feca7f9c9764c723",
        "cmQhigh_bytes": "943c210e1d9e9a4cc081cac733f5dd0884a00a994bdaefb3eb774295bde990342c4217070626e020cf28fe4d37bb1636",
        "cmQlow_bytes": "9556d341d28aab9df6c7351c70d694dd6cea329094bade2103f43136cced7e2cdef131557356416d06bfc7ad6edd7fa8",
        "cmQmid_bytes": "86fcf05ba85f8d619615b254fdd1c3336e7e90c10300f1bd7a5462816fd480ed607b9215fc13d4da83d601c834b97d51",
        "cmZ1_bytes": "89a8443d20e775d81aaf1f0e1ea2fc39ab6441262d5056ff8b1f84d3e3f857d20eb0756117db0964b3143dbac4d8aca8",
        "cmZ2_bytes": "a03f0439e903bc9f31b1defd0c7a696a8b51c7bf2edfab69eb88cbf850a72c595734569741e8974feff5911f7ef2ca19",
        "f_xi_int": BigInt("39281712569359409276312230137418806232948235452281866890615590760411358059177"),
        "h1_xi'_int": BigInt("47888357462879179424018152368163066956928813768470721810651126267458256981177"),
        "h2_xi_int": BigInt("30438153658789436363195680368224193344328332634140660410104582133468964470958"),
        "l1_xi": BigInt("21800020880207859894788531589329807880095087931944023163487935069857759305260"),
        "l_xi": [
          BigInt("21800020880207859894788531589329807880095087931944023163487935069857759305260"),
          BigInt("40265868307887984033375293996932305567689561053538376358554694509523168828450")
        ],
        "proof1_bytes": "887c4048dec743498d23c6bda2ff32dff2b174326eb0ff014d01a293de5193b6d6864154682a6d928ad86e303075aaf7",
        "proof2_bytes": "97dd3e4e4675f650097acf49d9090aac45e164a04ddb4a57b5fd6742ce5bb6e5de4465c8047146c7cfa2d90d529e3f88",
        "s1_xi_int": BigInt("50130256499111251245601710530523211270389150299772187781614456163137192174416"),
        "s2_xi_int": BigInt("14421487045599301007661737469681317753860311516817135361009085011423915564060"),
        "t_xi'_int": BigInt("17352601412788316495398472766582239149430845477631353158284449962457221757298"),
        "t_xi_int": BigInt("14956959606356352778750607339746281278716507818281841289429864397989463617433"),
        "z1_xi'_int": BigInt("7670986145620266950431732944838946933359623351317453555994318097854656105474"),
        "z2_xi'_int": BigInt("21053261546304947366319999751120858982355527648257311804403084966343956511857")
      }
    };

    const payload = serialize(requestData);

    console.log('📦 Payload type:', typeof payload);
    console.log('📦 Payload length:', payload.length);
    console.log('📦 JWT length:', requestData.jwt.length);
    console.log('📦 Payment key hash length:', requestData.payment_key_hash.length);

    // Write payload to file for inspection
    const fs = await import('fs');
    fs.writeFileSync('/tmp/activation-payload.json', payload);
    console.log('📦 Full payload written to /tmp/activation-payload.json');

    // Step 3: Send activation request directly to zkFold
    try {
      const response = await axios.post(
        'https://wallet-api.zkfold.io/v0/wallet/activate',
        payload,
        {
          headers: {
            'Content-Type': 'application/json',
            'api-key': process.env.ZKFOLD_API_KEY || ''
          },
          // Tell axios NOT to transform the request (already a JSON string)
          transformRequest: [(data) => data]
        }
      );

      console.log('✅ Activation response:', response.data);
      expect(response.status).toBe(200);
      expect(response.data.address).toBeDefined();
    } catch (error: any) {
      console.error('❌ Activation error:', error.response?.data || error.message);
      console.error('❌ Status:', error.response?.status);

      // Re-throw to fail the test
      throw error;
    }
  });
});