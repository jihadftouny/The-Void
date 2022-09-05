/*
 * Click nbfs://nbhost/SystemFileSystem/Templates/Licenses/license-default.txt to change this license
 * Click nbfs://nbhost/SystemFileSystem/Templates/Classes/Class.java to edit this template
 */
package com.mycompany.thevoid;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.Map;
import java.util.Random;
import jdk.nashorn.internal.objects.NativeArray;

/**
 *
 * @author jihad
 */
public class Enemy extends Character {

    Random rand = new Random();
    //variable that stores the player current xp
    int playerXp;
    public static String fullName = "";

    public Enemy(String name, int playerXp) {
        super(name, 1, (int) (Math.random() * (playerXp / 4 + 2) + 1)); //name maxhp xp
        this.playerXp = playerXp; //this here sets the variable playerXp with the variable that was given in the parameter declaration (which was set on object creation)
        EnemyName enemyName = new EnemyName(name);
        
        fullName = enemyName.fullName;
        

        Stats[0] = 10 + (int) (Math.random() * (playerXp / 4 + 1) + xp / 4 + 3);
        Stats[1] = 10 + (int) (Math.random() * (playerXp / 4 + 1) + xp / 4 + 3);
    }

    


    public void setStatsEnemy() {

        double a;
        double b;
        int playerLevel = GameLogic.act;

        //this if else chain will set playerLevel randomyl based on act, utilizing DnD Levels of play
        if (playerLevel == 4) {
            playerLevel = (int) (Math.random() * (21 - 17)) + 17;   // 20-17 (max-min)
        } else if (playerLevel == 3) {
            playerLevel = (int) (Math.random() * (17 - 11)) + 11;   // 16-11
        } else if (playerLevel == 2) {
            playerLevel = (int) (Math.random() * (11 - 5)) + 5;     // 10-5
        } else {
            playerLevel = (int) (Math.random() * (5 - 1)) + 1;      // 5-1
        }

        //CR = challenge rating
        double CRmax, CRmin, CRboss;

        //The following will set max and minimum (also boss) Challenge Ratings based on playerLevel
        //min
        a = 0.087970550572;
        b = 1.4100213799828;
        CRmin = a * Math.pow(playerLevel, b);

        //max
        a = 0.2320721484759;
        b = 1.319592522878;
        CRmax = a * Math.pow(playerLevel, b);

        //boss
        a = 0.4294334810279;
        b = 1.165240310288;
        CRboss = a * Math.pow(playerLevel, b);

        System.out.println("min max boss\n" + CRmin + " " + CRmax + " " + CRboss);

    }

    @Override
    public int attack() {
        return 0;
//        return (int) (Math.random() * (playerXp / 4 + 1) + xp / 4 + 3);
    }

    @Override
    public int defend() {
        return 0;
//        return (int) (Math.random() * (playerXp / 4 + 1) + xp / 4 + 3);
    }

}
