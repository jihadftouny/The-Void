/*
 * Click nbfs://nbhost/SystemFileSystem/Templates/Licenses/license-default.txt to change this license
 * Click nbfs://nbhost/SystemFileSystem/Templates/Classes/Class.java to edit this template
 */
package com.mycompany.thevoid;

/**
 *
 * @author jihad
 */
public class Armor extends Item {

    //ARMOR CLASS, ARMOR CLASS MOD (DEX), ARMOR STRENGTH REQUIRED
    int armorAC, armorACM, armorStr;

    // ARMOR JAVA OBJECTS
    // ACT 1
    public static final Armor testArmor11 = new Armor("Standard Power Armor", 5, "Common", 11, 2, 0);
    public static final Armor testArmor21 = new Armor("Energy-Absorbing Suit", 5, "Rare", 12, 2, 14);
    public static final Armor testArmor31 = new Armor("Guardian's Shield", 5, "Legendary", 12, 2, 14);

    // ACT 2
    public static final Armor testArmor12 = new Armor("Jooj Armor 2", 5, "Common", 11, 2, 0);
    public static final Armor testArmor22 = new Armor("Jaaj Armor 2", 5, "Rare", 12, 2, 14);
    public static final Armor testArmor32 = new Armor("Jiij Armor 2", 5, "Legendary", 12, 2, 14);

    // ACT 3
    public static final Armor testArmor13 = new Armor("Jooj Armor 3", 5, "Common", 11, 2, 0);
    public static final Armor testArmor23 = new Armor("Jaaj Armor 3", 5, "Rare", 12, 2, 14);
    public static final Armor testArmor33 = new Armor("Jiij Armor 3", 5, "Legendary", 12, 2, 14);

    // ACT 4
    public static final Armor testArmor14 = new Armor("Jooj Armor 4", 5, "Common", 11, 2, 0);
    public static final Armor testArmor24 = new Armor("Jaaj Armor 4", 5, "Rare", 12, 2, 14);
    public static final Armor testArmor34 = new Armor("Jiij Armor 4", 5, "Legendary", 12, 2, 14);

    public static Armor[] ArmorsAct1 = {testArmor11, testArmor21, testArmor31};
    public static Armor[] ArmorsAct2 = {testArmor12, testArmor22, testArmor32};
    public static Armor[] ArmorsAct3 = {testArmor13, testArmor23, testArmor33};
    public static Armor[] ArmorsAct4 = {testArmor14, testArmor24, testArmor34};

    public Armor(String itemName, int itemCost, String itemRarity, int armorAC, int armorACM, int armorStr) {
        super(itemName, itemCost, itemRarity);
        this.armorAC = armorAC;
        this.armorACM = armorACM;
        this.armorStr = armorStr;
    }
}
