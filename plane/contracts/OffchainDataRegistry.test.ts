import "@nomicfoundation/hardhat-toolbox";
import "@nomicfoundation/hardhat-ethers";
import { expect } from "chai";
import hre from "hardhat";
const { ethers } = hre as any;

describe("OffchainDataRegistry", function () {
  let registry: any;
  let owner: any;
  let otherAccount: any;

  beforeEach(async function () {
    // Lấy danh sách tài khoản test từ Hardhat
    [owner, otherAccount] = await ethers.getSigners();
    
    // Triển khai contract
    const Registry = await ethers.getContractFactory("OffchainDataRegistry");
    registry = await Registry.deploy();
  });

  it("Should set and get a CID correctly for the caller", async function () {
    const key = "profile";
    const cid = "QmTest123456789";

    // owner gọi setCID
    const tx = await registry.setCID(key, cid);
    await tx.wait();

    // Kiểm tra getCID cho owner
    expect(await registry.getCID(owner.address, key)).to.equal(cid);
    
    // Tài khoản khác không có CID này vì nó mapping theo address
    expect(await registry.getCID(otherAccount.address, key)).to.equal("");
  });

  it("Should emit DataUpdated event correctly on setCID", async function () {
    const key = "settings";
    const cid = "QmSettings987";
    const keyHash = ethers.id(key); // hash keccak256 của key

    // Kỳ vọng event được emit với các tham số tương ứng
    await expect(registry.setCID(key, cid))
      .to.emit(registry, "DataUpdated")
      .withArgs(owner.address, keyHash, key, cid, (time: any) => time > 0); // time > 0 để check timestamp hợp lệ
  });

  it("Should delete a CID correctly and emit event", async function () {
    const key = "profile";
    const cid = "QmTest123456789";

    await registry.setCID(key, cid);
    expect(await registry.getCID(owner.address, key)).to.equal(cid);

    const keyHash = ethers.id(key);

    // Gọi deleteCID và check event
    await expect(registry.deleteCID(key))
      .to.emit(registry, "DataUpdated")
      .withArgs(owner.address, keyHash, key, "", (time: any) => time > 0);

    // Kiểm tra lại sau khi xóa
    expect(await registry.getCID(owner.address, key)).to.equal("");
  });

  describe("setCIDIfMatches (Optimistic Concurrency)", function () {
    it("Should allow updating if the expected old CID matches the current one", async function () {
      const key = "plane_dapp_db";
      const initialCid = "QmInitialCID";
      const newCid = "QmNewCID";

      // 1. Ghi CID ban đầu
      await registry.setCID(key, initialCid);
      expect(await registry.getCID(owner.address, key)).to.equal(initialCid);

      // 2. Ghi đè với điều kiện khớp CID cũ
      const tx = await registry.setCIDIfMatches(key, initialCid, newCid);
      await tx.wait();

      // 3. Kiểm tra đã ghi đè thành công
      expect(await registry.getCID(owner.address, key)).to.equal(newCid);
    });

    it("Should allow initial write (empty string) if it matches", async function () {
      const key = "new_data_key";
      const emptyCid = "";
      const newCid = "QmNewDataCID";

      // Trạng thái ban đầu chưa có gì
      expect(await registry.getCID(owner.address, key)).to.equal(emptyCid);

      // Ghi lần đầu với expectedOldCid là chuỗi rỗng
      const tx = await registry.setCIDIfMatches(key, emptyCid, newCid);
      await tx.wait();

      expect(await registry.getCID(owner.address, key)).to.equal(newCid);
    });

    it("Should revert with CID_CONFLICT if the expected old CID does not match (Race Condition)", async function () {
      const key = "plane_dapp_db";
      const baseCid = "QmBaseCID";
      const userACid = "QmUserACID";
      const userBCid = "QmUserBCID";

      // Khởi tạo ban đầu
      await registry.setCID(key, baseCid);

      // Cả User A và B đều đọc được baseCid
      // User A gửi transaction ghi trước
      await registry.setCIDIfMatches(key, baseCid, userACid);
      expect(await registry.getCID(owner.address, key)).to.equal(userACid);

      // User B gửi transaction ghi sau, nhưng vẫn xài baseCid cũ
      // Contract phải revert lỗi CID_CONFLICT
      await expect(
        registry.setCIDIfMatches(key, baseCid, userBCid)
      ).to.be.revertedWith("CID_CONFLICT: data changed elsewhere, please reload");

      // Dữ liệu cuối cùng phải giữ nguyên của User A
      expect(await registry.getCID(owner.address, key)).to.equal(userACid);
    });
  });
});
