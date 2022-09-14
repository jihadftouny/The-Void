/*
 * Click nbfs://nbhost/SystemFileSystem/Templates/Licenses/license-default.txt to change this license
 * Click nbfs://nbhost/SystemFileSystem/Templates/Classes/Class.java to edit this template
 */
package com.mycompany.thevoid;

/**
 * @author jihad
 */
public class Weapon extends Item {

    Dice weaponAtkRoll;
    String weaponProperty; // Melee, Ranged, Finesse

    // ACT 1
    public static final Weapon testWeapon11 = new Weapon("Jooj Gun 1", 5, "Common", Dice.d4, "Ranged");
    public static final Weapon testWeapon21 = new Weapon("Jaaj Sword 1", 5, "Rare", Dice.d6, "Melee");
    public static final Weapon testWeapon31 = new Weapon("Jiij Rapier 1", 5, "Legendary", Dice.d8, "Finesse");

    // ACT 2
    public static final Weapon testWeapon12 = new Weapon("Jooj Gun 2", 5, "Common", Dice.d4, "Ranged");
    public static final Weapon testWeapon22 = new Weapon("Jaaj Sword 2", 5, "Rare", Dice.d6, "Melee");
    public static final Weapon testWeapon32 = new Weapon("Jiij Rapier 2", 5, "Legendary", Dice.d8, "Finesse");

    // ACT 3
    public static final Weapon testWeapon13 = new Weapon("Jooj Gun 3", 5, "Common", Dice.d4, "Ranged");
    public static final Weapon testWeapon23 = new Weapon("Jaaj Sword 3", 5, "Rare", Dice.d6, "Melee");
    public static final Weapon testWeapon33 = new Weapon("Jiij Rapier 3", 5, "Legendary", Dice.d8, "Finesse");

    // ACT 4
    public static final Weapon testWeapon14 = new Weapon("Jooj Gun 4", 5, "Common", Dice.d4, "Ranged");
    public static final Weapon testWeapon24 = new Weapon("Jaaj Sword 4", 5, "Rare", Dice.d6, "Melee");
    public static final Weapon testWeapon34 = new Weapon("Jiij Rapier 4", 5, "Legendary", Dice.d8, "Finesse");

    public static Weapon[] WeaponsAct1 = {testWeapon11, testWeapon21, testWeapon31};
    public static Weapon[] WeaponsAct2 = {testWeapon12, testWeapon22, testWeapon32};
    public static Weapon[] WeaponsAct3 = {testWeapon13, testWeapon23, testWeapon33};
    public static Weapon[] WeaponsAct4 = {testWeapon14, testWeapon24, testWeapon34};

    public Weapon(String itemName, int itemCost, String itemRarity, Dice weaponAtkRoll, String weaponProperty) {
        super(itemName, itemCost, itemRarity);
        this.weaponAtkRoll = weaponAtkRoll;
        this.weaponProperty = weaponProperty;
    }
}
